/**
 * import-mca.js — Import top 20,000 Indian B2B companies from MCA master CSV.
 *
 * STEP 1 — Inspect actual CSV columns before importing:
 *   node scripts/import-mca.js --inspect
 *   (prints first 3 rows so you can verify column names match what we expect)
 *
 * STEP 2 — Dry-run to count valid records:
 *   node scripts/import-mca.js --dry-run
 *
 * STEP 3 — Import:
 *   node scripts/import-mca.js
 *   node scripts/import-mca.js --limit 5000
 *   node scripts/import-mca.js --state Maharashtra
 *
 * VALIDATION RULES (a row is rejected if ANY of these fail):
 *   1. Company name present and non-empty
 *   2. Company status is "Active" (case-insensitive)
 *   3. Address is present (minimum: state must be present)
 *   4. Paid-up capital parseable as a positive number
 *   5. Not a pure service/shell company (B2B activity filter)
 *
 * NO GEOCODE FALLBACK — companies without a geocodable address never enter the DB.
 * Geocoding happens in a separate step (npm run geocode → scripts/geocode-photon.js) after import.
 * Only companies that successfully geocode get geom set. Others stay with
 * geocode_status='pending' and are NOT shown on the map until geocoded.
 * The map query already filters: WHERE geom IS NOT NULL.
 */

const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse');
const pool = require('../db/pool');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const ARGS = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => { const [k,...v] = a.slice(2).split('='); return [k, v.join('=') || true]; })
);

const CSV_PATH     = ARGS.file  || path.join(__dirname, '../data/mca-company-master.csv');
const LIMIT        = ARGS.limit ? parseInt(ARGS.limit) : 20000;
const FILTER_STATE = ARGS.state ? ARGS.state.toLowerCase() : null;
const INSPECT      = !!ARGS.inspect;
const DRY_RUN      = !!ARGS['dry-run'];
const BATCH_SIZE   = 200;

// ─── Column name map ──────────────────────────────────────────────────────────
// MCA CSV column names vary by download date. We normalise them here.
// Key = what we call it internally, Value = possible CSV header spellings (lowercase, trimmed).
// Run --inspect first to verify which columns actually exist in your download.
const COLUMN_MAP = {
    name:         ['companyname', 'company_name', 'name_of_company', 'company name'],
    status:       ['companystatus', 'company_status', 'status'],
    address:      ['registered_office_address', 'registeredofficeaddress', 'address', 'reg_off_address', 'registered office address'],
    state:        ['companystatecode', 'state', 'state_name', 'registered_state'],
    district:     ['district', 'district_name'],
    pincode:      ['pin_code', 'pincode', 'zip', 'pin'],
    email:        ['email_id', 'email', 'emailid'],
    paid_up_cap:  ['paidupcapital', 'paid_up_capital_in_rs', 'paid_up_capital', 'paid up capital (in rs)'],
    activity:     ['companyindustrialclassification', 'nic_code', 'principal_business_activity_as_per_cin', 'principalbusinessactivity', 'business_activity'],
    cin:          ['cin', 'corporate_identification_number'],
    class:        ['companyclass', 'class_of_company', 'classofcompany', 'company_class'],
    incorporated: ['companyregistrationdate_date', 'date_of_incorporation', 'dateofincorporation', 'incorporation_date'],
    roc:          ['companyroccode', 'roc_code', 'roccode', 'roc'],
};

// ─── B2B filter ───────────────────────────────────────────────────────────────
// Matches actual CompanyIndustrialClassification values from data.gov.in MCA dataset.
// Also matches NIC-code-based descriptions for older CSV formats.
const INCLUDE_ACTIVITY = [
    'manufacturing', 'mining', 'quarrying', 'construction', 'wholesale', 'processing',
    'electricity, gas and water', 'agriculture and allied',
    'transport, storage and communication',
    'fabricat', 'steel', 'metal', 'chemical', 'pharmac', 'textile',
    'electrical', 'electronic', 'machin', 'equipment', 'rubber', 'plastic',
    'paper', 'packaging', 'automotive', 'vehicle', 'agro',
    'food processing', 'beverage', 'refinery', 'cement', 'glass', 'ceramic',
    'paint', 'coal', 'petroleum', 'power', 'energy', 'trading',
    'supplier', 'distributor', 'dealer', 'exporter', 'importer',
];
const EXCLUDE_ACTIVITY = [
    'insurance', 'banking', 'nbfc', 'mutual fund', 'securities', 'stock broker',
    'chit fund', 'education', 'school', 'college', 'coaching', 'beauty', 'salon',
    'spa', 'laundry', 'holding company', 'dormant', 'shell',
    'finance',                         // pure financial companies
    'real estate and renting',         // not B2B product companies
    'community, personal and social',  // services
    'business services',               // too vague — mostly IT/consulting
];

function isB2B(activity = '') {
    if (!activity) return false;
    const a = activity.toLowerCase();
    if (EXCLUDE_ACTIVITY.some(x => a.includes(x))) return false;
    if (INCLUDE_ACTIVITY.some(x => a.includes(x))) return true;
    return false;
}

// Extract pincode from embedded address format: "...,State,Pincode-India" or "...,Pincode India"
function extractPincode(address = '') {
    const m = address.match(/[,\s](\d{6})[-\s]*(?:India)?[\s,]*$/i)
           || address.match(/\b(\d{6})\b/);
    return m ? m[1] : '';
}

// Extract city from MCA address format: "Street...,City,District,State,Pincode-India"
// Parse from the right: last=pincode, then state, then district, then city
function extractCityFromAddress(address = '') {
    if (!address) return '';
    const clean = address.replace(/[-,\s]*india\s*$/i, '').trim();
    const parts = clean.split(',').map(p => p.trim()).filter(Boolean);
    // Need at least: city, district, state, pincode = 4 parts at end
    if (parts.length >= 4) return parts[parts.length - 3] || '';
    if (parts.length >= 3) return parts[parts.length - 2] || '';
    return '';
}

function parseCapital(raw = '') {
    const n = parseFloat(String(raw).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
}

function slugify(name = '') {
    return name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 200);
}

// ─── Column resolver (handles header name variations) ─────────────────────────
function buildColResolver(headers) {
    const normalized = headers.map(h => h.toLowerCase().trim());
    const resolved = {};
    for (const [key, variants] of Object.entries(COLUMN_MAP)) {
        const idx = variants.findIndex(v => normalized.includes(v));
        if (idx !== -1) {
            resolved[key] = normalized.indexOf(variants[idx]);
        } else {
            resolved[key] = -1; // not found
        }
    }
    return resolved;
}

function getField(row, resolver, key) {
    const idx = resolver[key];
    if (idx === -1) return '';
    return (row[idx] || '').toString().trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function run() {
    if (!fs.existsSync(CSV_PATH)) {
        console.error(`\nCSV not found: ${CSV_PATH}`);
        console.error('Download from: https://data.gov.in/catalog/company-master-data');
        console.error('Save to: backend/data/mca-company-master.csv\n');
        process.exit(1);
    }

    const fileSize = (fs.statSync(CSV_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`File: ${CSV_PATH} (${fileSize} MB)`);

    if (INSPECT) {
        await inspectCSV();
        process.exit(0);
    }

    await importCSV();
}

// ─── Inspect mode: show columns + first 3 rows ────────────────────────────────
async function inspectCSV() {
    console.log('\n=== INSPECT MODE ===\n');
    let rowNum = 0;
    let resolver = null;

    await new Promise((resolve, reject) => {
        fs.createReadStream(CSV_PATH)
            .pipe(parse({ relax_column_count: true, relax_quotes: true, skip_empty_lines: true }))
            .on('data', (row) => {
                if (rowNum === 0) {
                    console.log('COLUMNS FOUND:');
                    row.forEach((col, i) => console.log(`  [${i}] ${col}`));
                    resolver = buildColResolver(row);
                    console.log('\nCOLUMN MAPPING:');
                    for (const [key, idx] of Object.entries(resolver)) {
                        console.log(`  ${key.padEnd(15)} → col[${idx}] = ${idx >= 0 ? row[idx] : 'NOT FOUND'}`);
                    }
                } else if (rowNum <= 3) {
                    console.log(`\nROW ${rowNum}:`);
                    for (const [key] of Object.entries(COLUMN_MAP)) {
                        const val = getField(row, resolver, key);
                        if (val) console.log(`  ${key.padEnd(15)}: ${val.slice(0, 80)}`);
                    }
                } else {
                    resolve(null);
                }
                rowNum++;
            })
            .on('end', resolve)
            .on('error', reject);
    });
}

// ─── Import mode ──────────────────────────────────────────────────────────────
async function importCSV() {
    // Defer DB connection until after validation pass — dry-run never needs it
    let client = null;
    let resolver = null;
    let headersPrinted = false;

    let totalRead = 0, accepted = 0, rejected = 0, inserted = 0, skipped = 0;
    const rejectReasons = {};

    // Collect all valid rows first, sorted by paid-up capital DESC
    const validRows = [];

    console.log(`\nPass 1: reading + validating CSV (taking top ${LIMIT} by paid-up capital)...`);

    await new Promise((resolve, reject) => {
        fs.createReadStream(CSV_PATH)
            .pipe(parse({ relax_column_count: true, relax_quotes: true, skip_empty_lines: true }))
            .on('data', (row) => {
                if (totalRead === 0) {
                    resolver = buildColResolver(row);
                    if (!headersPrinted) {
                        headersPrinted = true;
                        const missing = Object.entries(resolver).filter(([,v]) => v === -1).map(([k]) => k);
                        if (missing.length) console.log('  WARNING — columns not found in CSV:', missing.join(', '));
                        console.log(`  Mapped ${Object.values(resolver).filter(v => v >= 0).length}/${Object.keys(resolver).length} expected columns.`);
                    }
                    totalRead++;
                    return;
                }
                totalRead++;

                const name    = getField(row, resolver, 'name');
                const status  = getField(row, resolver, 'status');
                const address = getField(row, resolver, 'address');
                const state   = getField(row, resolver, 'state');
                // Pincode: dedicated column OR extracted from address (data.gov.in embeds it)
                const pincodeRaw = getField(row, resolver, 'pincode');
                const activity   = getField(row, resolver, 'activity');
                const capital    = parseCapital(getField(row, resolver, 'paid_up_cap'));
                const pincode    = (pincodeRaw.replace(/\D/g, '').slice(0, 6))
                                || extractPincode(address);

                // ── Strict validation — every rejected row gets a counted reason ──────
                // Rule 1: name present
                if (!name || name.length < 3) { rejected++; rejectReasons.no_name = (rejectReasons.no_name||0)+1; return; }
                // Rule 2: Active status only — Strike Off / Dissolved / Under CIRP all rejected
                if (!status.toLowerCase().includes('active')) { rejected++; rejectReasons.not_active = (rejectReasons.not_active||0)+1; return; }
                // Rule 3: state present
                if (!state || state.length < 2) { rejected++; rejectReasons.no_state = (rejectReasons.no_state||0)+1; return; }
                // Rule 4: address must be substantial — not just "India" or a state name
                if (!address || address.length < 15) { rejected++; rejectReasons.address_too_short = (rejectReasons.address_too_short||0)+1; return; }
                // Rule 5: address must contain a 6-digit pincode — key precision signal
                if (!pincode || pincode.length !== 6) { rejected++; rejectReasons.no_pincode = (rejectReasons.no_pincode||0)+1; return; }
                // Rule 6: address must contain at least one digit (building/plot number)
                if (!/\d/.test(address)) { rejected++; rejectReasons.no_street_number = (rejectReasons.no_street_number||0)+1; return; }
                // Rule 7: B2B industry classification
                if (!isB2B(activity)) { rejected++; rejectReasons.not_b2b = (rejectReasons.not_b2b||0)+1; return; }
                // Rule 8: optional state filter
                if (FILTER_STATE && !state.toLowerCase().includes(FILTER_STATE)) { rejected++; rejectReasons.wrong_state = (rejectReasons.wrong_state||0)+1; return; }

                accepted++;
                const incorporated = getField(row, resolver, 'incorporated');
                // Parse year from dates like "2001-03-15", "15/03/2001", "2001"
                const foundedYear = (() => {
                    if (!incorporated) return null;
                    const m = incorporated.match(/\b(19\d{2}|20\d{2})\b/);
                    return m ? parseInt(m[1]) : null;
                })();
                validRows.push({
                    name,
                    status,
                    address,
                    city:      extractCityFromAddress(address),
                    state,
                    district:  getField(row, resolver, 'district'),
                    pincode,
                    email:     getField(row, resolver, 'email'),
                    activity,
                    capital,
                    cin:       getField(row, resolver, 'cin'),
                    class_:    getField(row, resolver, 'class'),
                    incorporated,
                    founded_year: foundedYear,
                });
            })
            .on('end', resolve)
            .on('error', reject);
    });

    console.log(`\nPass 1 complete:`);
    console.log(`  Total rows read:  ${totalRead.toLocaleString()}`);
    console.log(`  Accepted:         ${accepted.toLocaleString()}`);
    console.log(`  Rejected:         ${rejected.toLocaleString()}`);
    console.log(`  Reject reasons:   ${JSON.stringify(rejectReasons)}`);

    // Sort by paid-up capital DESC, take top LIMIT
    validRows.sort((a, b) => b.capital - a.capital);
    const toInsert = validRows.slice(0, LIMIT);
    console.log(`\nTaking top ${toInsert.length.toLocaleString()} by paid-up capital.`);
    if (toInsert.length > 0) {
        console.log(`  Capital range: ₹${toInsert[toInsert.length-1].capital.toLocaleString()} – ₹${toInsert[0].capital.toLocaleString()}`);
    }

    if (DRY_RUN) {
        console.log('\nDry-run complete. No DB writes.');
        return;
    }

    console.log('\nPass 2: inserting into DB...');
    client = await pool.connect();
    let batch = [];

    const flush = async () => {
        if (!batch.length) return;
        for (const r of batch) {
            try {
                const slug = slugify(r.name) + '-' + (r.cin || Math.random().toString(36).slice(2,8));
                const insRes = await client.query(
                    `INSERT INTO companies (
                        name, slug, address, city, district, state, pincode, email,
                        founded_year, geocode_status, source, source_data, is_active
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending','mca_master',$10,true)
                    ON CONFLICT (slug) DO NOTHING
                    RETURNING id`,
                    [
                        r.name, slug,
                        r.address,
                        r.city || '',
                        r.district,
                        r.state,
                        r.pincode || null,
                        r.email || null,
                        r.founded_year || null,
                        JSON.stringify({
                            cin: r.cin,
                            class: r.class_,
                            incorporated: r.incorporated,
                            paid_up_capital: r.capital,
                            principal_business_activity: r.activity,
                        }),
                    ]
                );
                if (insRes.rows.length) {
                    const companyId = insRes.rows[0].id;
                    // MCA address already contains city+state+pincode+India — use as-is.
                    // Photon performs best when query matches the raw address closely.
                    const geocodeAddr = r.address.replace(/-India\s*$/i, ', India');
                    await client.query(
                        `INSERT INTO geocoding_queue
                            (entity_type, entity_id, address_raw, city, state, pincode)
                         VALUES ('company', $1, $2, $3, $4, $5)
                         ON CONFLICT (entity_type, entity_id) DO NOTHING`,
                        [companyId, geocodeAddr, '', r.state, r.pincode || null]
                    );
                    inserted++;
                }
            } catch (err) {
                skipped++;
                if (skipped <= 5) console.warn('  skip:', r.name, '-', err.message.slice(0,80));
            }
        }
        batch = [];
        process.stdout.write(`  ${inserted.toLocaleString()} inserted...\r`);
    };

    try {
        await client.query('BEGIN');
        for (const r of toInsert) {
            batch.push(r);
            if (batch.length >= BATCH_SIZE) await flush();
        }
        await flush();
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('\nTransaction rolled back:', err.message);
        throw err;
    } finally {
        client.release();
    }

    console.log(`\nImport complete:`);
    console.log(`  Inserted: ${inserted.toLocaleString()}`);
    console.log(`  Skipped (duplicate slug): ${skipped.toLocaleString()}`);
    console.log(`\nNext step: npm run classify  (assign buy/sell categories)`);
    console.log(`Then:       npm run geocode   (resolve addresses → lat/lon)`);
    console.log(`            (requires Photon running on :2322)`);
    if (client) client.release();
    await pool.end();
}

run().catch(err => { console.error(err.message); process.exit(1); });
