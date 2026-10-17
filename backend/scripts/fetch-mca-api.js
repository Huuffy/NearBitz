/**
 * fetch-mca-api.js — Download MCA company master data from data.gov.in.
 *
 * Uses the internal data.gov.in proxy endpoint (discovered by inspecting
 * browser network traffic — the public api.data.gov.in server is offline).
 *
 * 3.67 million companies available. Has full address + NIC code.
 *
 * USAGE:
 *   node scripts/fetch-mca-api.js --api-key=YOUR_KEY --inspect
 *   node scripts/fetch-mca-api.js --api-key=YOUR_KEY
 *   node scripts/fetch-mca-api.js --api-key=YOUR_KEY --limit=50000
 *   node scripts/fetch-mca-api.js --api-key=YOUR_KEY --state=maharashtra
 *
 * API key (free): https://data.gov.in → register → profile → API Key tab
 *
 * RESUME: interrupted fetches resume automatically from progress file.
 * NEXT STEP after fetch: npm run import:mca
 */

const fs    = require('fs');
const path  = require('path');
const fetch = require('node-fetch');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const ARGS = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => { const [k,...v] = a.slice(2).split('='); return [k, v.join('=') || true]; })
);

const API_KEY      = ARGS['api-key'] || process.env.DATAGOV_API_KEY;
const INSPECT      = !!ARGS.inspect;
const LIMIT        = ARGS.limit  ? parseInt(ARGS.limit)  : Infinity;
const STATE_FILTER = ARGS.state  ? ARGS.state.toLowerCase() : null;
const PAGE_SIZE    = 100;

const OUT_PATH     = ARGS.out  || path.join(__dirname, '../data/mca-company-master.csv');
const PROG_PATH    = path.join(__dirname, '../data/mca-fetch-progress.json');

// Working endpoint — data.gov.in internal proxy (api.data.gov.in is offline)
const BASE_URL = 'https://data.gov.in/backend/dataapi/v1/resource/4dbe5667-7b6b-41d7-82af-211562424d9a';
const HEADERS  = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept':     'application/json',
    'Referer':    'https://data.gov.in/',
};

// Default: fetch Active companies sorted by paid-up capital desc.
// This way 80K records gives us the highest-value B2B companies — no need to
// download all 3.67M. After B2B filter (~40% pass) 80K → ~32K → top 20K.
const DEFAULT_FILTERS = {
    'filters[CompanyStatus]': 'Active',
    'sort[PaidupCapital]':    'desc',
};

if (!API_KEY) {
    console.error('\nERROR: API key required.');
    console.error('  Get one free: https://data.gov.in → register → profile → API Key tab');
    console.error('  Then: node scripts/fetch-mca-api.js --api-key=YOUR_KEY --inspect\n');
    process.exit(1);
}

// ─── Fetch one page ───────────────────────────────────────────────────────────
async function fetchPage(offset, extra = {}) {
    const params = new URLSearchParams({
        'api-key': API_KEY,
        format:    'json',
        offset,
        limit:     PAGE_SIZE,
        ...DEFAULT_FILTERS,
        ...extra,
    });
    const res = await fetch(`${BASE_URL}?${params}`, { headers: HEADERS, timeout: 30000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return res.json();
}

// ─── Inspect mode ─────────────────────────────────────────────────────────────
async function inspect() {
    console.log('\n=== INSPECT MODE ===\n');
    const data = await fetchPage(0);

    console.log(`Total records: ${parseInt(data.total || 0).toLocaleString()}`);
    console.log(`\nALL FIELDS (${(data.field || []).length}):`);
    (data.field || []).forEach((f, i) => console.log(`  [${i}] ${f.id}`));

    console.log('\nSAMPLE RECORDS (first 3):');
    (data.records || []).slice(0, 3).forEach((row, i) => {
        console.log(`\n  Record ${i + 1}:`);
        Object.entries(row).forEach(([k, v]) => {
            if (v && String(v).trim()) console.log(`    ${String(k).padEnd(42)}: ${String(v).slice(0, 80)}`);
        });
    });

    // Check import-mca.js column mapping compatibility
    console.log('\n--- COLUMN MAPPING CHECK ---');
    const fields = (data.field || []).map(f => f.id.toLowerCase());
    const checks = {
        'name':        ['companyname'],
        'status':      ['companystatus'],
        'address':     ['registered_office_address'],
        'state':       ['companystatecode'],
        'activity':    ['nic_code', 'companyindustrialclassification'],
        'paid_up_cap': ['paidupcapital'],
        'cin':         ['cin'],
    };
    for (const [key, variants] of Object.entries(checks)) {
        const found = variants.find(v => fields.includes(v));
        console.log(`  ${key.padEnd(15)}: ${found ? `✓ "${found}"` : '✗ NOT FOUND'}`);
    }

    console.log('\n✓ Ready to fetch. Run without --inspect to download.');
    console.log(`  node scripts/fetch-mca-api.js --api-key=YOUR_KEY`);
}

// ─── Derive clean state string from record ────────────────────────────────────
function getState(record) {
    return (record.CompanyStateCode || '').toLowerCase().trim();
}

// ─── Main fetch ───────────────────────────────────────────────────────────────
async function run() {
    // Quick connectivity check
    try {
        const check = await fetchPage(0);
        const total = parseInt(check.total || 0);
        console.log(`\nConnected. Total records available: ${total.toLocaleString()}`);

        if (STATE_FILTER) {
            console.log(`State filter: ${STATE_FILTER}`);
        }
        if (LIMIT !== Infinity) {
            console.log(`Limit: ${LIMIT.toLocaleString()}`);
        }
    } catch (e) {
        console.error(`\nConnection failed: ${e.message}`);
        console.error('Run --inspect to diagnose.');
        process.exit(1);
    }

    // Resume support
    let startOffset = 0;
    let fetched = 0;
    let skippedState = 0;
    let csvHeaders = null;
    let outStream;

    if (fs.existsSync(PROG_PATH)) {
        try {
            const prog = JSON.parse(fs.readFileSync(PROG_PATH, 'utf8'));
            if (!prog.complete && prog.stateFilter === (STATE_FILTER || '')) {
                console.log(`Resuming from offset ${prog.nextOffset.toLocaleString()} (${prog.fetched.toLocaleString()} already fetched)`);
                startOffset = prog.nextOffset;
                fetched     = prog.fetched;
                csvHeaders  = prog.csvHeaders || null;
                outStream   = fs.createWriteStream(OUT_PATH, { flags: 'a' });
            }
        } catch (_) {}
    }

    if (!outStream) {
        outStream = fs.createWriteStream(OUT_PATH, { flags: 'w' });
    }

    // Get total from first page
    const firstPage = await fetchPage(startOffset);
    const total = parseInt(firstPage.total || 0);

    // Write header from first page if fresh start
    if (startOffset === 0) {
        const keys = Object.keys(firstPage.records?.[0] || {});
        if (keys.length) {
            csvHeaders = keys;
            outStream.write(csvHeaders.join(',') + '\n');
        }
    }

    // Process first page records
    for (const record of (firstPage.records || [])) {
        if (!csvHeaders) {
            csvHeaders = Object.keys(record);
            outStream.write(csvHeaders.join(',') + '\n');
        }
        if (STATE_FILTER && !getState(record).includes(STATE_FILTER)) { skippedState++; continue; }
        outStream.write(toCSVRow(record, csvHeaders) + '\n');
        fetched++;
        if (fetched >= LIMIT) break;
    }

    let offset = startOffset + firstPage.records.length;

    console.log(`\nFetching ${Math.min(total, LIMIT === Infinity ? total : LIMIT).toLocaleString()} records...\n`);

    while (offset < total && fetched < LIMIT) {
        try {
            const data = await fetchPage(offset);
            const records = data.records || [];
            if (!records.length) break;

            for (const record of records) {
                if (!csvHeaders) {
                    csvHeaders = Object.keys(record);
                    outStream.write(csvHeaders.join(',') + '\n');
                }
                if (STATE_FILTER && !getState(record).includes(STATE_FILTER)) { skippedState++; continue; }
                outStream.write(toCSVRow(record, csvHeaders) + '\n');
                fetched++;
                if (fetched >= LIMIT) break;
            }

            offset += records.length;

            if (fetched % 500 === 0) {
                process.stdout.write(`\r  ${fetched.toLocaleString()} saved, offset ${offset.toLocaleString()} / ${total.toLocaleString()}   `);
            }

            fs.writeFileSync(PROG_PATH, JSON.stringify({
                nextOffset: offset, fetched, stateFilter: STATE_FILTER || '',
                csvHeaders, total, complete: false,
            }));

            await new Promise(r => setTimeout(r, 150));

        } catch (err) {
            console.error(`\nError at offset ${offset}: ${err.message}`);
            console.error('Retrying in 10s...');
            await new Promise(r => setTimeout(r, 10000));
        }
    }

    outStream.end();
    fs.writeFileSync(PROG_PATH, JSON.stringify({ complete: true, fetched, stateFilter: STATE_FILTER || '' }));

    console.log(`\n\nFetch complete:`);
    console.log(`  Records saved:  ${fetched.toLocaleString()}`);
    if (skippedState) console.log(`  Skipped (wrong state): ${skippedState.toLocaleString()}`);
    console.log(`  CSV saved to:   ${OUT_PATH}`);
    const sizeMB = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1);
    console.log(`  File size:      ${sizeMB} MB`);
    console.log(`\nNext step:`);
    console.log(`  node scripts/import-mca.js --inspect`);
    console.log(`  node scripts/import-mca.js --dry-run`);
    console.log(`  npm run import:mca`);
}

function toCSVRow(record, headers) {
    return headers.map(h => {
        const val = String(record[h] ?? '').replace(/"/g, '""');
        return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
    }).join(',');
}

if (INSPECT) {
    inspect().catch(err => { console.error(err.message); process.exit(1); });
} else {
    run().catch(err => { console.error(err.message); process.exit(1); });
}
