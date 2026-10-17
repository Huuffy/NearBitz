/**
 * classify-mca-companies.js
 *
 * After import-mca.js loads companies from the MCA CSV, this script
 * auto-assigns buy and sell product categories to each company based on:
 *   1. Their principal_business_activity (stored in source_data JSONB)
 *   2. Their primary_industry_id
 *
 * This gives every company a non-empty buy/sell profile before any user
 * has registered, so map pins show relevant product tags immediately.
 *
 * USAGE:
 *   node scripts/classify-mca-companies.js
 *   node scripts/classify-mca-companies.js --batch=1000   (process N at a time)
 *   node scripts/classify-mca-companies.js --dry-run      (print only, no writes)
 */

const pool = require('../db/pool');

const BATCH  = parseInt(process.argv.find(a => a.startsWith('--batch='))?.split('=')[1] || '500');
const DRY    = process.argv.includes('--dry-run');

// ─── Activity → sell HSN codes ────────────────────────────────────────────────
// Keys match the EXACT activity strings in source_data after normalisation.
// Sell = what the company PRODUCES / ships out to customers.
// 8 most precise HSN headings per activity.
const MCA_ACTIVITY_TO_SELL_HSN = {
    // ── Metals and Chemicals ──────────────────────────────────────────────────
    // Sell: steel coils/plates, structural sections, pipes, castings, chemicals, lubricants
    'manufacturing  metals and chemicals  and products thereof ': [
        '7208',   // HR steel coils/plates
        '7213',   // steel wire rods
        '7214',   // TMT bars / rebars
        '7304',   // seamless steel pipes
        '7306',   // welded steel pipes
        '7318',   // fasteners (bolts, nuts, screws)
        '2902',   // cyclic hydrocarbons / aromatic solvents
        '3403',   // lubricating oils and greases
    ],

    // ── Machinery and Equipment ───────────────────────────────────────────────
    // Sell: pumps, fans, heat exchangers, motors, switchgear, cables, bearings, valves
    'manufacturing  machinery and equipments ': [
        '8413',   // pumps for liquids
        '8414',   // fans, blowers, compressors
        '8481',   // valves (gate, ball, globe)
        '8482',   // ball and roller bearings
        '8501',   // electric motors
        '8504',   // electrical transformers
        '8537',   // electrical control panels / MCCs
        '8544',   // insulated electric cables and wires
    ],

    // ── Construction ─────────────────────────────────────────────────────────
    // Sell: construction services + prefab structures, precast concrete, fabricated steel
    'construction': [
        '7308',   // structural steel fabrications (bridges, towers, frames)
        '7314',   // steel wire mesh / expanded metal
        '6810',   // precast concrete articles
        '6904',   // building bricks
        '6907',   // ceramic floor/wall tiles
        '2523',   // Portland cement
        '9406',   // prefabricated buildings / site offices
        '4418',   // wooden builders' joinery (doors, windows, frames)
    ],

    // ── Agriculture ──────────────────────────────────────────────────────────
    // Sell: grains, oilseeds, cotton, vegetables, spices, fertilizers
    'agriculture and allied activities': [
        '1006',   // rice
        '1001',   // wheat
        '1201',   // soybeans
        '1202',   // groundnuts (peanuts)
        '5201',   // raw cotton (cotton lint)
        '0713',   // dried pulses (lentils, chickpeas)
        '0906',   // cinnamon and spices
        '3105',   // complex NPK fertilizers
    ],

    // ── Textiles ─────────────────────────────────────────────────────────────
    // Sell: yarn, woven/knitted fabric, garments, technical textiles
    'manufacturing  textiles ': [
        '5205',   // cotton yarn (single, combed)
        '5402',   // synthetic filament yarn (polyester, nylon)
        '5503',   // polyester staple fibre
        '5209',   // cotton woven fabric (denim, canvas)
        '5407',   // woven synthetic filament fabric
        '6109',   // T-shirts and vests (knitted)
        '6205',   // men's shirts (woven)
        '6305',   // woven sacks (FIBC, jute bags)
    ],

    // ── Food stuffs ───────────────────────────────────────────────────────────
    // Sell: milled products, edible oils, packaged foods, sugar, beverages
    'manufacturing  food stuffs ': [
        '1006',   // milled rice / rice flour
        '1101',   // wheat / maize flour
        '1507',   // soybean oil (refined)
        '1511',   // palm oil
        '1701',   // raw cane sugar
        '1905',   // bread, biscuits, pastry
        '2103',   // sauces, pastes, spice powders
        '2106',   // packaged food preparations
    ],

    // ── Transport ────────────────────────────────────────────────────────────
    // Sell: commercial vehicles, trailers, logistics infrastructure
    'transport  storage and communications': [
        '8704',   // trucks and lorries (diesel/electric)
        '8716',   // semi-trailers and trailers
        '8609',   // shipping containers
        '8428',   // conveyor equipment for warehousing
        '9406',   // prefabricated warehouse structures
        '4819',   // corrugated boxes and cartons
        '8544',   // cables for logistics infrastructure
        '3923',   // plastic crates and pallets
    ],

    // ── Electricity, Gas and Water ────────────────────────────────────────────
    // Sell: electrical energy, transformers, generators, solar panels, cables, gas, water treatment
    'electricity  gas and water companies': [
        '2716',   // electrical energy (the primary product sold)
        '8504',   // power/distribution transformers
        '8502',   // generating sets (DG sets, backup power)
        '8541',   // solar photovoltaic panels / cells
        '8535',   // HV switchgear and circuit breakers
        '8544',   // ACSR/XLPE cables for power transmission
        '2711',   // natural gas / LNG / LPG supply
        '9028',   // electricity meters
    ],

    // ── Paper and Paper Products ──────────────────────────────────────────────
    // Sell: paper, paperboard, corrugated boxes, cartons, labels
    'manufacturing  paper and paper products  publishing  printingand reproduction of recorded media ': [
        '4804',   // kraft paper (unbleached)
        '4810',   // coated printing/writing paper
        '4819',   // corrugated boxes and cartons
        '4820',   // registers, notebooks, stationery
        '4821',   // self-adhesive labels
        '4803',   // tissue / hygiene paper
        '4811',   // laminated / coated paperboard
        '4901',   // printed books and publications
    ],

    // ── Manufacturing Others ──────────────────────────────────────────────────
    // Catch-all: furniture, medical devices, plastics, misc industrial
    'manufacturing  others ': [
        '9403',   // office and industrial furniture
        '9018',   // medical/surgical instruments
        '3920',   // plastic sheets and film
        '7326',   // other fabricated steel articles (stampings, forgings)
        '8302',   // furniture hardware (hinges, castors, handles)
        '6911',   // ceramic tableware and kitchenware
        '3924',   // plastic tableware and kitchenware
        '9506',   // sports and fitness equipment
    ],

    // ── Mining and Quarrying ──────────────────────────────────────────────────
    // Sell: iron ore, coal, limestone, granite, sand, industrial minerals
    'mining and quarrying': [
        '2601',   // iron ores and concentrates
        '2701',   // coal and anthracite
        '2521',   // limestone and calcite
        '2516',   // granite, basalt, sandstone blocks
        '2517',   // crushed stone, gravel, sand
        '2603',   // copper ores and concentrates
        '2608',   // zinc ores and concentrates
        '2520',   // gypsum and anhydrite
    ],

    // ── Wood Products ─────────────────────────────────────────────────────────
    // Sell: sawn timber, plywood, MDF, particle board, wooden doors/furniture
    'manufacturing  wood products ': [
        '4407',   // sawn or chipped timber (teak, pine, eucalyptus)
        '4412',   // plywood and multi-ply panels
        '4413',   // densified / laminated wood
        '4418',   // wooden doors, windows, flooring strips
        '9401',   // seating (wooden chairs, sofas)
        '9403',   // wooden furniture (tables, wardrobes, beds)
        '4409',   // wood mouldings and profiled timber
        '4414',   // wooden picture frames / decorative items
    ],

    // ── Leather ───────────────────────────────────────────────────────────────
    // Sell: finished leather, leather goods, safety footwear
    'manufacturing  leather and products thereof ': [
        '4107',   // full-grain bovine leather
        '4112',   // sheep/lamb leather
        '4202',   // leather bags, briefcases, wallets
        '4203',   // leather garments and gloves
        '6403',   // safety boots and leather footwear
        '4205',   // leather belts and straps
        '4101',   // raw bovine hides (tannery input sold to buyers)
        '4113',   // leather of other animals
    ],

    // ── Trading ───────────────────────────────────────────────────────────────
    // B2B trading companies — primary commodities traded in India
    'trading': [
        '7213',   // steel wire rods (most-traded steel product)
        '7214',   // TMT bars / rebars
        '2523',   // Portland cement
        '2710',   // petroleum products (HSD, furnace oil, lubricants)
        '3901',   // polyethylene granules
        '2902',   // aromatic hydrocarbons / solvents
        '1006',   // rice
        '7318',   // fasteners and hardware
    ],
};

// ─── Activity → what that type of company typically BUYS as inputs ────────────
// Buy = raw materials, components, machinery and services purchased.
// Separate map per activity — independent of industry slug.
const MCA_ACTIVITY_TO_BUY_HSN = {
    'manufacturing  metals and chemicals  and products thereof ': [
        '2601',   // iron ore / DRI (direct reduced iron input)
        '2701',   // coking coal for blast furnace
        '2521',   // limestone flux
        '6902',   // refractory bricks for furnace lining
        '8545',   // graphite electrodes for EAF steelmaking
        '2804',   // industrial oxygen and nitrogen gases
        '8501',   // electric arc furnace motors / rolling mill drives
        '3403',   // rolling lubricants and quenching oils
    ],

    'manufacturing  machinery and equipments ': [
        '7213',   // steel wire rods (for shafts, fasteners)
        '7214',   // structural steel (frames and housings)
        '7326',   // steel castings and forgings (body parts)
        '7318',   // fasteners (assembly)
        '8482',   // ball and roller bearings
        '8484',   // seals and gaskets
        '7408',   // copper wire for motor windings
        '8536',   // electrical switches and fuses (panels)
    ],

    'construction': [
        '2523',   // Portland cement (bulk purchase)
        '7214',   // TMT bars / rebars (structural reinforcement)
        '7213',   // structural steel sections
        '2517',   // crushed stone, sand, aggregates
        '4412',   // plywood for formwork and shuttering
        '6907',   // ceramic tiles (finishing)
        '7005',   // flat glass (windows, facades)
        '3208',   // exterior paints and primers
    ],

    'agriculture and allied activities': [
        '3102',   // urea (most-used nitrogen fertilizer)
        '3104',   // potassium chloride (MOP)
        '3105',   // DAP and NPK complex fertilizers
        '3808',   // pesticides, herbicides, fungicides
        '1209',   // certified crop seeds
        '8701',   // tractors
        '8433',   // harvesters and threshers
        '3917',   // drip irrigation pipes (HDPE/LDPE)
    ],

    'manufacturing  textiles ': [
        '5201',   // raw cotton (spinning mill input)
        '3907',   // polyester chips (PET → fibre/yarn)
        '3908',   // nylon chips (PA6/PA66)
        '3204',   // reactive and disperse dyes
        '3813',   // scouring and de-sizing chemicals
        '8445',   // ring spinning frames
        '8446',   // power looms and air-jet looms
        '8451',   // stenter and mercerising machines
    ],

    'manufacturing  food stuffs ': [
        '1001',   // raw wheat (flour mill input)
        '1201',   // soybeans (oil extraction)
        '1212',   // sugar cane / sugar beet
        '3919',   // BOPP film for packaging
        '4819',   // corrugated cartons
        '8438',   // food processing machinery (extruders, mixers)
        '8422',   // filling and sealing machines
        '8418',   // industrial refrigeration equipment
    ],

    'transport  storage and communications': [
        '8704',   // trucks (fleet purchase)
        '4011',   // new pneumatic tyres (truck / commercial)
        '2710',   // HSD / diesel fuel
        '3403',   // engine lubricants
        '8708',   // truck spare parts (clutch plates, diffs)
        '8507',   // lead-acid batteries (truck)
        '4823',   // packing paper and void fill
        '8544',   // wiring harness for commercial vehicles
    ],

    'electricity  gas and water companies': [
        '2701',   // coal (primary fuel for thermal power plants)
        '2711',   // natural gas / LNG (gas-based power plants)
        '7605',   // aluminium conductors (ACSR overhead lines)
        '7408',   // copper conductor (power cables)
        '8546',   // porcelain and glass insulators
        '2710',   // transformer oil (mineral insulating oil)
        '8406',   // steam turbines (thermal generation)
        '8501',   // generators and alternators (power generation)
    ],

    'manufacturing  paper and paper products  publishing  printingand reproduction of recorded media ': [
        '4703',   // chemical wood pulp (kraft pulp)
        '4707',   // waste paper and paperboard for recycling
        '2815',   // caustic soda (cooking liquor)
        '2801',   // chlorine (bleaching)
        '3213',   // optical brightening agents
        '8439',   // paper-making machines (Fourdrinier)
        '8441',   // cutting, rewinding, corrugating machines
        '8413',   // process pumps (stock and chemical)
    ],

    'manufacturing  others ': [
        '7213',   // steel wire rods
        '7214',   // structural steel
        '3901',   // polyethylene granules
        '3920',   // plastic sheets for thermoforming
        '8501',   // electric motors (general purpose)
        '7318',   // fasteners (assembly)
        '3208',   // industrial paints and coatings
        '4412',   // plywood for furniture / packaging
    ],

    'mining and quarrying': [
        '8430',   // drilling and rock-breaking machines
        '8429',   // bulldozers, scrapers, graders
        '3602',   // safety fuses and detonators (blasting)
        '8428',   // conveyors and belt systems for ore handling
        '4011',   // OTR (off-the-road) tyres for dump trucks
        '8413',   // slurry and dewatering pumps
        '8544',   // mining cables (armoured, flame-retardant)
        '7304',   // steel casing pipes for boreholes
    ],

    'manufacturing  wood products ': [
        '4403',   // logs (teak, eucalyptus, pine)
        '4708',   // wood pulp for MDF binder
        '3909',   // urea-formaldehyde resin (MDF/plywood binder)
        '3506',   // PVA / contact adhesive
        '3919',   // melamine-faced laminates
        '8465',   // CNC panel saws, planers, routers
        '7318',   // fasteners (cabinet assembly)
        '3208',   // wood primers and lacquers
    ],

    'manufacturing  leather and products thereof ': [
        '4101',   // raw salted / dried hides
        '3202',   // synthetic tanning agents (syntans)
        '2833',   // basic chromium sulphate (chrome tanning)
        '3204',   // leather dyes
        '3906',   // acrylic finishing resins
        '6406',   // shoe soles and heels (components)
        '8452',   // industrial sewing machines
        '8453',   // leather finishing and embossing machines
    ],

    'trading': [
        '7208',   // HR steel coils (procured from mills)
        '7213',   // wire rods (procured from mills)
        '2523',   // cement bags (procured from cement plants)
        '3901',   // polymer granules (procured from petrochemicals)
        '2710',   // petroleum products
        '1006',   // rice (procured from millers)
        '7318',   // hardware / fasteners
        '2902',   // chemicals / solvents
    ],
};

// ─── Activity → industry slug mapping ────────────────────────────────────────
// Keys use normalised forms to match the fuzzy matcher output.
const ACTIVITY_TO_INDUSTRY = {
    // Exact normalised keys for the 14 activities actually in our DB
    'manufacturing  metals and chemicals  and products thereof ': 'steel-metals',
    'manufacturing  textiles ': 'textiles',
    'manufacturing  food stuffs ': 'food-beverage',
    'manufacturing  machinery and equipments ': 'machinery',
    'agriculture and allied activities': 'agriculture',
    'transport  storage and communications': 'logistics',
    'electricity  gas and water companies': 'electrical',
    'manufacturing  paper and paper products  publishing  printingand reproduction of recorded media ': 'paper',
    'manufacturing  others ': 'machinery',   // generic
    'mining and quarrying': 'steel-metals',
    'manufacturing  wood products ': 'construction',
    'manufacturing  leather and products thereof ': 'textiles',
    'trading': 'steel-metals',
    'construction': 'construction',
};

// ─── Normalise activity text ───────────────────────────────────────────────────
function normaliseActivity(raw) {
    if (!raw) return '';
    // Strip parentheses and punctuation to spaces; collapse whitespace
    return raw.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Fuzzy-match raw activity to a map's keys using token overlap.
// Normalises BOTH input AND key before splitting — prevents "(machinery"
// from being treated as a distinct token from "machinery".
function fuzzyMatch(norm, map) {
    if (map[norm]) return map[norm];
    const inputTokens = new Set(norm.split(' ').filter(w => w.length > 2));
    let bestKey = null, bestScore = 0;
    for (const key of Object.keys(map)) {
        const normKey = normaliseActivity(key); // strip parens from key too
        const keyTokens = normKey.split(' ').filter(w => w.length > 2);
        if (!keyTokens.length) continue;
        const overlap = keyTokens.filter(t => inputTokens.has(t)).length;
        const score = overlap / keyTokens.length;
        if (score > bestScore) { bestScore = score; bestKey = key; }
    }
    return (bestScore >= 0.4 && bestKey) ? map[bestKey] : null;
}

function matchSellHsns(raw) {
    const norm = normaliseActivity(raw);
    return fuzzyMatch(norm, MCA_ACTIVITY_TO_SELL_HSN)
        || MCA_ACTIVITY_TO_SELL_HSN['trading'];   // safe fallback
}

function matchBuyHsns(raw) {
    const norm = normaliseActivity(raw);
    return fuzzyMatch(norm, MCA_ACTIVITY_TO_BUY_HSN)
        || MCA_ACTIVITY_TO_BUY_HSN['trading'];   // safe fallback
}

// Derive industry slug from activity
function activityToIndustrySlug(raw) {
    const norm = normaliseActivity(raw);
    return fuzzyMatch(norm, ACTIVITY_TO_INDUSTRY) || null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
    // Build HSN slug → category id map (for resolving HSN 4-digit codes)
    const hsnRows = await pool.query(
        "SELECT id, slug FROM product_categories WHERE slug LIKE 'hsn-%'"
    );
    const hsnToId = new Map(hsnRows.rows.map(r => [r.slug.replace('hsn-', ''), r.id]));
    console.log(`Loaded ${hsnToId.size} HSN category nodes.`);

    // Build industry slug → id map (and id → slug)
    const indRows = await pool.query('SELECT id, slug FROM industries');
    const slugToIndId = new Map(indRows.rows.map(r => [r.slug, r.id]));
    const indIdToSlug = new Map(indRows.rows.map(r => [r.id, r.slug]));

    // Count companies needing classification (missing sell OR buy products)
    const countRes = await pool.query(
        `SELECT COUNT(*) FROM companies c
         WHERE NOT EXISTS (SELECT 1 FROM company_products_sell s WHERE s.company_id = c.id)
            OR NOT EXISTS (SELECT 1 FROM company_products_buy  b WHERE b.company_id = c.id)`
    );
    const total = parseInt(countRes.rows[0].count);
    console.log(`${total} companies need classification — processing...`);

    let processed = 0, errors = 0;

    // Always fetch from offset 0 — as companies get classified, the WHERE NOT EXISTS
    // condition shrinks the set, so the next batch automatically picks up the remainder.
    while (true) {
        const batch = await pool.query(
            `SELECT c.id, c.primary_industry_id, c.source_data
             FROM companies c
             WHERE NOT EXISTS (SELECT 1 FROM company_products_sell s WHERE s.company_id = c.id)
                OR NOT EXISTS (SELECT 1 FROM company_products_buy  b WHERE b.company_id = c.id)
             ORDER BY c.created_at
             LIMIT $1`,
            [BATCH]
        );
        if (!batch.rows.length) break;

        for (const company of batch.rows) {
            try {
                const activity = company.source_data?.principal_business_activity || '';
                // Derive industry from activity (company may not have primary_industry_id set yet)
                const inferredSlug = activityToIndustrySlug(activity)
                                  || indIdToSlug.get(company.primary_industry_id)
                                  || null;
                const inferredIndustryId = slugToIndId.get(inferredSlug) || null;

                const sellHsns = matchSellHsns(activity);
                const buyHsns  = matchBuyHsns(activity);

                if (DRY) {
                    console.log(`[dry] ${company.id} | activity="${activity.slice(0,50)}" | industry=${inferredSlug} | sell=${sellHsns.slice(0,3).join(',')} | buy=${buyHsns.slice(0,3).join(',')}`);
                    continue;
                }

                // Set primary_industry_id if not already set
                if (inferredIndustryId && !company.primary_industry_id) {
                    await pool.query(
                        `UPDATE companies SET primary_industry_id = $1 WHERE id = $2`,
                        [inferredIndustryId, company.id]
                    );
                    // Also insert into company_industries junction table
                    await pool.query(
                        `INSERT INTO company_industries (company_id, industry_id)
                         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
                        [company.id, inferredIndustryId]
                    );
                }

                // Insert sell products (top 5 HSN codes)
                for (const hsn of sellHsns.slice(0, 5)) {
                    const catId = hsnToId.get(hsn);
                    if (!catId) continue;
                    await pool.query(
                        `INSERT INTO company_products_sell (id, company_id, category_id)
                         VALUES (gen_random_uuid(), $1, $2)
                         ON CONFLICT (company_id, category_id) DO NOTHING`,
                        [company.id, catId]
                    );
                }

                // Insert buy products (top 5 HSN codes)
                for (const hsn of buyHsns.slice(0, 5)) {
                    const catId = hsnToId.get(hsn);
                    if (!catId) continue;
                    await pool.query(
                        `INSERT INTO company_products_buy (id, company_id, category_id)
                         VALUES (gen_random_uuid(), $1, $2)
                         ON CONFLICT (company_id, category_id) DO NOTHING`,
                        [company.id, catId]
                    );
                }
            } catch (e) {
                errors++;
            }
        }

        processed += batch.rows.length;
        process.stdout.write(`\r  ${processed} companies classified (${errors} errors)...`);
    }

    console.log(`\n\n✓ Classification complete:`);
    console.log(`  ${processed} companies processed`);
    console.log(`  ${errors} errors`);
    if (DRY) console.log('  (dry run — no writes made)');

    await pool.end();
}

run().catch(err => {
    console.error(err);
    process.exit(1);
});
