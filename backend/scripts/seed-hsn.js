/**
 * Seeds product_categories with the COMPLETE HSN taxonomy — all 4 levels.
 *
 * Data source: hsn-code-package (CBIC / WCO ITC-HS, auto-updated via npm)
 *   To get latest data: npm update hsn-code-package && node scripts/seed-hsn.js --replace
 *
 * Levels seeded:
 *   L0 — Chapter   (2-digit):   95 nodes   e.g. "84 — Machinery"
 *   L1 — Heading   (4-digit): 1246 nodes   e.g. "8413 — Pumps for liquids"
 *   L2 — Sub-heading (6-digit): 5634 nodes e.g. "841391 — Parts of pumps"
 *   L3 — Tariff item (8-digit): 12604 nodes e.g. "84139110 — Impeller for centrifugal pump"
 *
 * Total: ~19,579 nodes covering every product in Indian commerce.
 *
 * Usage:
 *   node scripts/seed-hsn.js              # insert/update only (safe to re-run)
 *   node scripts/seed-hsn.js --replace    # wipe and re-seed from scratch
 *   node scripts/seed-hsn.js --level=2    # seed up to L2 only (skip L3)
 */

const pool = require('../db/pool');

const REPLACE   = process.argv.includes('--replace');
const MAX_LEVEL = parseInt((process.argv.find(a => a.startsWith('--level=')) || '--level=3').split('=')[1]);



// ── Chapter → industry sector ────────────────────────────────────────────────
const CH_INDUSTRY = {
    '01':'agriculture','02':'agriculture','03':'agriculture','04':'agriculture','05':'agriculture',
    '06':'agriculture','07':'agriculture','08':'agriculture','09':'agriculture','10':'agriculture',
    '11':'agriculture','12':'agriculture','13':'agriculture','14':'agriculture','15':'agriculture',
    '16':'fmcg-food',  '17':'fmcg-food',  '18':'fmcg-food',  '19':'fmcg-food',  '20':'fmcg-food',
    '21':'fmcg-food',  '22':'fmcg-food',  '23':'fmcg-food',  '24':'fmcg-food',
    '25':'construction','26':'steel-metals','27':'chemicals',
    '28':'chemicals',  '29':'chemicals',  '30':'pharma',     '31':'agriculture','32':'chemicals',
    '33':'chemicals',  '34':'chemicals',  '35':'chemicals',  '36':'chemicals',  '37':'chemicals',
    '38':'chemicals',
    '39':'rubber-plastics','40':'rubber-plastics',
    '41':'textiles',   '42':'textiles',   '43':'textiles',
    '44':'construction','45':'construction','46':'construction',
    '47':'chemicals',  '48':'chemicals',  '49':'chemicals',
    '50':'textiles',   '51':'textiles',   '52':'textiles',   '53':'textiles',   '54':'textiles',
    '55':'textiles',   '56':'textiles',   '57':'textiles',   '58':'textiles',   '59':'textiles',
    '60':'textiles',   '61':'textiles',   '62':'textiles',   '63':'textiles',
    '64':'fmcg-food',  '65':'fmcg-food',  '66':'fmcg-food',  '67':'fmcg-food',
    '68':'construction','69':'construction','70':'construction',
    '71':'steel-metals',
    '72':'steel-metals','73':'steel-metals','74':'steel-metals','75':'steel-metals',
    '76':'steel-metals','78':'steel-metals','79':'steel-metals','80':'steel-metals',
    '81':'steel-metals','82':'steel-metals','83':'steel-metals',
    '84':'machinery',  '85':'electrical',
    '86':'logistics',  '87':'automotive', '88':'logistics',  '89':'logistics',
    '90':'machinery',  '91':'it-tech',    '92':'machinery',  '93':'machinery',
    '94':'construction','95':'fmcg-food', '96':'fmcg-food',  '97':'it-tech',
};

const CH_NAME = {
    '01':'Live animals','02':'Meat and edible meat offal','03':'Fish and crustaceans',
    '04':'Dairy produce, eggs, honey','05':'Products of animal origin NES',
    '06':'Live trees and other plants','07':'Edible vegetables and roots',
    '08':'Edible fruit and nuts','09':'Coffee, tea, spices','10':'Cereals',
    '11':'Products of the milling industry','12':'Oil seeds, industrial plants',
    '13':'Lac, gums, resins','14':'Vegetable plaiting materials',
    '15':'Animal or vegetable fats and oils','16':'Preparations of meat, fish',
    '17':'Sugars and sugar confectionery','18':'Cocoa and cocoa preparations',
    '19':'Preparations of cereals, flour','20':'Preparations of vegetables, fruit',
    '21':'Miscellaneous edible preparations','22':'Beverages, spirits and vinegar',
    '23':'Residues and waste from food industry','24':'Tobacco and tobacco substitutes',
    '25':'Salt, sulphur, earths, stone, cement','26':'Ores, slag and ash',
    '27':'Mineral fuels, oils and waxes','28':'Inorganic chemicals',
    '29':'Organic chemicals','30':'Pharmaceutical products','31':'Fertilisers',
    '32':'Tanning, dyeing, paints, varnishes','33':'Essential oils, cosmetics, toiletries',
    '34':'Soap, waxes, lubricants, polishes','35':'Albuminoidal substances, glues, enzymes',
    '36':'Explosives, pyrotechnics, matches','37':'Photographic goods',
    '38':'Miscellaneous chemical products','39':'Plastics and articles thereof',
    '40':'Rubber and articles thereof','41':'Raw hides, skins and leather',
    '42':'Articles of leather, saddlery','43':'Furskins and artificial fur',
    '44':'Wood and articles of wood','45':'Cork and articles of cork',
    '46':'Manufactures of straw, basket ware','47':'Pulp of wood, paper waste',
    '48':'Paper and paperboard','49':'Printed books, newspapers, pictures',
    '50':'Silk','51':'Wool, fine or coarse animal hair','52':'Cotton',
    '53':'Other vegetable textile fibres','54':'Man-made filaments, yarns',
    '55':'Man-made staple fibres','56':'Wadding, felt, nonwovens, ropes',
    '57':'Carpets and other textile floor coverings',
    '58':'Special woven fabrics, lace, embroidery',
    '59':'Impregnated, coated or laminated fabrics','60':'Knitted or crocheted fabrics',
    '61':'Articles of apparel, knitted','62':'Articles of apparel, not knitted',
    '63':'Other made-up textile articles','64':'Footwear, gaiters',
    '65':'Headgear and parts thereof','66':'Umbrellas, walking-sticks, whips',
    '67':'Prepared feathers, artificial flowers',
    '68':'Articles of stone, plaster, cement','69':'Ceramic products',
    '70':'Glass and glassware','71':'Precious stones, metals, jewellery',
    '72':'Iron and steel','73':'Articles of iron or steel',
    '74':'Copper and articles thereof','75':'Nickel and articles thereof',
    '76':'Aluminium and articles thereof','78':'Lead and articles thereof',
    '79':'Zinc and articles thereof','80':'Tin and articles thereof',
    '81':'Other base metals, cermets','82':'Tools, implements, cutlery',
    '83':'Miscellaneous articles of base metal',
    '84':'Machinery, mechanical appliances, boilers',
    '85':'Electrical machinery, sound recorders, TV',
    '86':'Railway or tramway locomotives, rolling-stock',
    '87':'Vehicles (automobiles, tractors, motorcycles)',
    '88':'Aircraft, spacecraft','89':'Ships, boats, floating structures',
    '90':'Optical, photographic, measuring instruments',
    '91':'Clocks, watches and parts','92':'Musical instruments',
    '93':'Arms and ammunition',
    '94':'Furniture, bedding, lamps, prefab buildings',
    '95':'Toys, games, sports equipment',
    '96':'Miscellaneous manufactured articles',
    '97':'Works of art, collectors pieces, antiques',
};

// ── Description parser ────────────────────────────────────────────────────────
// Raw descriptions look like:
//   "HEADING DESC - SUB HEADING DESC: ITEM SPECIFIC DESC"
// We split on ' - ' and ': ' to extract the meaningful part at each level.

function parseDesc(raw) {
    const text = raw.replace(/\s+/g, ' ').trim();
    // Split on ' - ' first
    const dashParts = text.split(' - ');
    // The heading name is always in the first dash-segment
    const headingName = dashParts[0].trim();
    // Sub-heading name: second dash-segment, strip any embedded code (e.g. "8413 11")
    const subPart = dashParts[1] ? dashParts[1].replace(/\b\d{4}\s\d{2}\b/g, '').trim() : headingName;
    // Item-specific name: last colon-segment
    const colonParts = text.split(': ');
    const itemName = colonParts[colonParts.length - 1].trim();
    return { headingName, subPart, itemName };
}

function toKeywords(str) {
    return str.toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !['and','the','for','not','with','from','other',
            'thereof','articles','products','preparations','whether','fitted'].includes(w))
        .slice(0, 15);
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
    const client = await pool.connect();
    try {
        if (REPLACE) {
            console.log('REPLACE: clearing taxonomy tables...');
            await client.query('DELETE FROM product_aliases');
            await client.query('DELETE FROM salesman_products_sell');
            await client.query('DELETE FROM company_products_sell');
            await client.query('DELETE FROM company_products_buy');
            await client.query('DELETE FROM product_categories');
            console.log('  cleared.\n');
        }

        const pkg   = require('hsn-code-package');
        const stats = pkg.getStats();
        console.log(`hsn-code-package v${stats.version} | updated ${stats.lastUpdated} | ${stats.totalCodes} codes | source: ${stats.source}`);

        const allCodes = pkg.getAllHsn();

        // Build tree maps from raw codes
        // All codes padded to 8 digits
        // chapters[ch]   = { name, keyword }
        // headings[h4]   = { chap, firstDesc }
        // subheadings[h6]= { heading, firstDesc }
        // items[h8]      = { sub, desc }

        const chapters    = new Map(); // ch → { name }
        const headings    = new Map(); // h4 → firstDesc
        const subheadings = new Map(); // h6 → firstDesc
        const items       = allCodes.map(x => ({ code: x.code.padStart(8,'0'), desc: x.description }));

        items.forEach(({ code, desc }) => {
            const ch = code.slice(0,2);
            const h4 = code.slice(0,4);
            const h6 = code.slice(0,6);
            if (!chapters.has(ch))    chapters.set(ch, desc);
            if (!headings.has(h4))    headings.set(h4, desc);
            if (!subheadings.has(h6)) subheadings.set(h6, desc);
        });

        console.log(`Tree: ${chapters.size} chapters | ${headings.size} headings | ${subheadings.size} sub-headings | ${items.length} items\n`);

        // ID maps (code → DB id)
        const chId  = new Map();
        const h4Id  = new Map();
        const h6Id  = new Map();

        // ── L0: Chapters ─────────────────────────────────────────────────────
        console.log('Seeding L0 chapters...');
        for (const [ch] of [...chapters].sort((a,b) => a[0].localeCompare(b[0]))) {
            const slug = `hsn-ch-${ch}`;
            const name = `Chapter ${ch} — ${CH_NAME[ch] || 'HSN Chapter ' + ch}`;
            const kw   = toKeywords(CH_NAME[ch] || '');
            const row = await upsert(client, null, name, slug, 0, kw, ch);
            chId.set(ch, row.id);
        }
        console.log(`  ${chId.size} chapters done.\n`);

        // ── L1: Headings ─────────────────────────────────────────────────────
        console.log('Seeding L1 headings...');
        let n = 0;
        for (const [h4, raw] of [...headings].sort((a,b) => a[0].localeCompare(b[0]))) {
            const ch = h4.slice(0,2);
            const pid = chId.get(ch);
            if (!pid) continue;
            const { headingName } = parseDesc(raw);
            const name = `${h4} — ${headingName.slice(0,120)}`;
            const slug = `hsn-${h4}`;
            const kw = toKeywords(headingName);
            const row = await upsert(client, pid, name, slug, 1, kw, h4);
            h4Id.set(h4, row.id);
            if (++n % 300 === 0) process.stdout.write(`  ${n}/${headings.size}...\r`);
        }
        console.log(`  ${h4Id.size} headings done.   \n`);

        if (MAX_LEVEL < 2) { console.log('Stopped at L1 (--level=1).'); return; }

        // ── L2: Sub-headings ─────────────────────────────────────────────────
        console.log('Seeding L2 sub-headings...');
        n = 0;
        for (const [h6, raw] of [...subheadings].sort((a,b) => a[0].localeCompare(b[0]))) {
            const h4 = h6.slice(0,4);
            const pid = h4Id.get(h4);
            if (!pid) continue;
            const { subPart } = parseDesc(raw);
            const label = subPart && subPart !== parseDesc(raw).headingName ? subPart : `Sub-heading ${h6}`;
            const name = `${h6} — ${label.slice(0,120)}`;
            const slug = `hsn-${h6}`;
            const kw   = toKeywords(label);
            const row = await upsert(client, pid, name, slug, 2, kw, h6);
            h6Id.set(h6, row.id);
            if (++n % 500 === 0) process.stdout.write(`  ${n}/${subheadings.size}...\r`);
        }
        console.log(`  ${h6Id.size} sub-headings done.   \n`);

        if (MAX_LEVEL < 3) { console.log('Stopped at L2 (--level=2).'); return; }

        // ── L3: Tariff items ─────────────────────────────────────────────────
        console.log('Seeding L3 tariff items...');
        n = 0;
        for (const { code, desc } of [...items].sort((a,b) => a.code.localeCompare(b.code))) {
            const h6 = code.slice(0,6);
            const pid = h6Id.get(h6);
            if (!pid) continue;
            const { itemName } = parseDesc(desc);
            const label = itemName && itemName.length > 3 ? itemName : desc.slice(0,120);
            const name = `${code} — ${label.slice(0,120)}`;
            const slug = `hsn-${code}`;
            const kw   = toKeywords(label);
            await upsert(client, pid, name, slug, 3, kw, code);
            if (++n % 1000 === 0) process.stdout.write(`  ${n}/${items.length}...\r`);
        }
        console.log(`  ${n} tariff items done.   \n`);

        // ── Summary ───────────────────────────────────────────────────────────
        const { rows: [{ count }] } = await client.query(
            'SELECT COUNT(*) FROM product_categories'
        );
        const { rows: byLevel } = await client.query(
            'SELECT level, COUNT(*) FROM product_categories GROUP BY level ORDER BY level'
        );
        console.log(`\nTotal product_categories: ${count}`);
        byLevel.forEach(r => {
            const label = ['chapters','headings','sub-headings','tariff items'][r.level];
            console.log(`  L${r.level} ${label}: ${r.count}`);
        });
        console.log('\nHSN taxonomy seeding complete.');
        console.log('To update: npm update hsn-code-package && node scripts/seed-hsn.js --replace');

    } finally {
        client.release();
        await pool.end();
    }
}

// Upsert helper: insert or update, return {id}
async function upsert(client, parentId, name, slug, level, keywords, hsnCode) {
    const existing = await client.query(
        'SELECT id FROM product_categories WHERE slug = $1', [slug]
    );
    if (existing.rows.length) {
        await client.query(
            `UPDATE product_categories
             SET name=$1, keywords=$2, hsn_code=$3, level=$4, parent_id=$5, updated_at=NOW()
             WHERE id=$6`,
            [name, keywords, hsnCode, level, parentId, existing.rows[0].id]
        );
        return existing.rows[0];
    }
    const res = await client.query(
        `INSERT INTO product_categories (parent_id, name, slug, level, keywords, hsn_code, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [parentId, name, slug, level, keywords, hsnCode, Math.min(parseInt(hsnCode.replace(/\D/g,'').slice(0,4), 10) || 0, 32767)]
    );
    return res.rows[0];
}

run().catch(err => { console.error(err.message); process.exit(1); });
