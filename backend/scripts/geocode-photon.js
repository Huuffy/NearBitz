/**
 * Street-level geocoding of companies with a local Photon (>= 1.0) instance.
 *
 *   node scripts/geocode-photon.js            # process everything not yet geocoded by Photon
 *   node scripts/geocode-photon.js --limit 200 --dry
 *   node scripts/geocode-photon.js --retry    # also retry rows that previously missed
 *
 * A result is accepted only when it is house/street level AND agrees with the company's
 * pincode or city AND lies within MAX_KM of the city's centre. Anything coarser is stored
 * with geocode_precision='locality' (not shown on the map) or cleared ('none').
 * Resumable: rows are picked by geocode_source, so re-running continues where it stopped.
 */
const pool = require('../db/pool');

const PHOTON = process.env.PHOTON_URL || 'http://localhost:2322';
const CONCURRENCY = 6;
const MAX_KM = 40;
const BBOX = '68,6,97.5,37.2';

const args = process.argv.slice(2);
const LIMIT = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : null;
const DRY = args.includes('--dry');
const RETRY = args.includes('--retry');
const RECHECK = args.includes('--recheck-house');

const NOISE = [
    /\bc\/o\b[^,]*/gi,
    /\b(\d+(st|nd|rd|th)|ground|first|second|third|fourth|fifth|top|upper|lower|basement|mezzanine)\s*floor\b/gi,
    /\bfloor\s*(no\.?)?\s*\d+\b/gi,
    /\b(flat|office|shop|unit|room|suite)\s*(no\.?)?\s*[\w\/-]+/gi,
    /-?\s*india\s*$/i,
];

const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

function cleanSegments(address) {
    let a = address || '';
    for (const re of NOISE) a = a.replace(re, ' ');
    const seen = new Set();
    return a
        .split(/,|\s{3,}/)
        .map((s) => s.replace(/\s+/g, ' ').replace(/^[\s.\-]+|[\s.\-]+$/g, ''))
        .filter((s) => s.length > 1 && !/^\d{6}$/.test(s))
        .filter((s) => { const k = norm(s); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

const STREETY = /\b(road|rd|marg|street|st|lane|path|nagar|vihar|enclave|colony|sector|phase|area|estate|complex|chowk|bazar|bazaar|market|park|layout|extension|ext|avenue|cross|main|highway|nh)\b/i;
const GENERIC = new Set(('road rd marg street st lane path nagar complex area sector phase block india limited ltd ' +
    'private pvt the of and co company building house tower centre center plot no near opp opposite floor ' +
    'industrial estate east west north south new old city district').split(' '));
const tokens = (s) => norm(s).split(' ').filter((t) => t.length > 1 && !GENERIC.has(t));
const overlap = (a, b) => { const B = new Set(b); return a.length ? a.filter((t) => B.has(t)).length / a.length : 0; };

function cityName(c) {
    return (c.city || '').replace(/\b(city|district|dist)\b/gi, '').trim();
}

function queries(c) {
    const segs = cleanSegments(c.address);
    const pin = /^[1-9]\d{5}$/.test(c.pincode || '') ? c.pincode : '';
    const city = cityName(c);
    const out = [];
    out.push(segs.concat(pin ? [pin] : []).join(', '));                     // full cleaned address
    if (segs[0] && !/^\d/.test(segs[0])) out.push(`${segs[0]}, ${city}`);   // building / complex name
    for (const sg of segs.filter((x) => STREETY.test(x)).slice(0, 2)) out.push(`${sg}, ${city}`);
    if (segs.length > 3) out.push(segs.slice(1).join(', '));                 // without building
    return [...new Set(out.map((q) => q.replace(/\s+/g, ' ').trim()))].filter((q) => q.length > 6).slice(0, 5);
}

function km(lat1, lon1, lat2, lon2) {
    const r = Math.PI / 180;
    const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2
        + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(a));
}

// OSM objects that can stand for a company's building.
const BUILDING_KEYS = new Set(['building', 'office', 'amenity', 'shop', 'man_made', 'craft', 'industrial', 'company']);

function judge(c, f, centre) {
    const p = f.properties || {};
    const [lon, lat] = f.geometry.coordinates;
    const addrTok = tokens(`${c.address} ${c.name}`);
    const pinOk = !!(p.postcode && c.pincode && p.postcode.replace(/\s/g, '').slice(0, 6) === c.pincode);
    const cityKeys = [p.city, p.district, p.county, p.locality].map(norm).filter(Boolean);
    const cn = norm(cityName(c));
    const cityOk = !!cn && cityKeys.some((k) => k.includes(cn) || cn.includes(k));
    const dist = centre ? km(centre.lat, centre.lon, lat, lon) : 0;
    const ok = dist <= MAX_KM && (pinOk || cityOk);

    // City/state words say nothing about the building, so they never count towards a match.
    const placeTok = new Set(tokens(`${c.city} ${c.state} ${p.city || ''} ${p.county || ''} ${p.state || ''}`));
    const strip = (t) => t.filter((x) => !placeTok.has(x));
    const segs = cleanSegments(c.address);
    const headTok = strip(tokens(segs.slice(0, 2).join(' ')));
    const nameTok = strip(tokens(c.name));
    const addrNorm = ` ${norm(c.address)} `;

    let precision = 'locality';
    if (p.osm_key === 'place' || p.osm_key === 'boundary') {
        precision = 'locality';
    } else if (pinOk && p.housenumber && /\d/.test(p.housenumber) && addrNorm.includes(` ${norm(p.housenumber)} `)
               && p.street && overlap(strip(tokens(p.street)), addrTok) >= 0.6) {
        precision = 'house';
    } else if (BUILDING_KEYS.has(p.osm_key) && p.name) {
        const poi = strip(tokens(p.name));
        const companyMatch = poi.length > 0 && overlap(poi, nameTok) >= 0.5;
        const buildingMatch = poi.length > 0 && overlap(poi, headTok) === 1 && (poi.length >= 2 || p.osm_key === 'building');
        // Same-named roads/buildings exist across a city, so a building match needs the pincode too
        // unless the place is literally named after the company.
        if (companyMatch || (buildingMatch && pinOk)) precision = 'house';
        else if (pinOk && p.street && overlap(strip(tokens(p.street)), addrTok) >= 0.6) precision = 'street';
    } else if (p.type === 'street' && pinOk && overlap(strip(tokens(p.name)), addrTok) >= 0.6) {
        precision = 'street';
    }
    return { lat, lon, type: precision, precise: precision !== 'locality', ok, pinOk, dist, matched: [p.name, p.housenumber, p.street, p.osm_key].filter(Boolean).join(' / ') };
}

async function photon(q, centre) {
    const u = new URL('/api', PHOTON);
    u.searchParams.set('q', q);
    u.searchParams.set('limit', '5');
    u.searchParams.set('lang', 'en');
    u.searchParams.set('bbox', BBOX);
    if (centre) { u.searchParams.set('lat', centre.lat); u.searchParams.set('lon', centre.lon); }
    const res = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`photon ${res.status}`);
    return (await res.json()).features || [];
}

async function geocodeOne(c) {
    // The old jittered city-centre point is still a usable "which city" anchor for sanity checks.
    const centre = c.latitude != null ? { lat: c.latitude, lon: c.longitude } : null;
    let coarse = null;
    for (const q of queries(c)) {
        const feats = await photon(q, centre);
        const judged = feats.map((f) => judge(c, f, centre)).filter((j) => j.ok);
        const best = judged.find((j) => j.precise && j.pinOk) || judged.find((j) => j.precise);
        if (best) return { ...best, precision: best.type, query: q };
        if (!coarse && judged[0]) coarse = { ...judged[0], precision: 'locality', query: q };
    }
    return coarse || { precision: 'none' };
}

async function save(c, r) {
    if (DRY) return;
    if (r.precision === 'none') {
        await pool.query(
            `UPDATE companies SET latitude = NULL, longitude = NULL, geom = NULL,
                    geocode_source = 'photon', geocode_precision = 'none', geocode_status = 'failed',
                    geocoded_at = NOW() WHERE id = $1`, [c.id]);
        return;
    }
    await pool.query(
        `UPDATE companies SET latitude = $2, longitude = $3,
                geom = ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography,
                geocode_source = 'photon', geocode_precision = $4,
                geocode_confidence = $5, geocode_status = 'geocoded', geocoded_at = NOW()
         WHERE id = $1`,
        [c.id, r.lat, r.lon, r.precision, r.pinOk ? 1.0 : 0.7]);
}

(async () => {
    const health = await fetch(new URL('/api?q=mumbai&limit=1', PHOTON)).catch(() => null);
    if (!health?.ok) { console.error(`Photon is not reachable at ${PHOTON}`); process.exit(1); }

    const where = RECHECK
        ? `geocode_precision = 'house' AND geocode_confidence < 1`
        : RETRY
        ? `geocode_source IS DISTINCT FROM 'photon' OR geocode_precision IN ('none','locality')`
        : `geocode_source IS DISTINCT FROM 'photon'`;
    const { rows } = await pool.query(
        `SELECT id, name, address, city, state, pincode, latitude, longitude
         FROM companies WHERE ${where} ORDER BY pin_tier NULLS LAST, paid_up_capital DESC NULLS LAST
         ${LIMIT ? `LIMIT ${LIMIT}` : ''}`);
    console.log(`Geocoding ${rows.length} companies via ${PHOTON}${DRY ? ' (dry run)' : ''}`);

    const tally = { house: 0, street: 0, locality: 0, none: 0, error: 0 };
    let i = 0, done = 0;
    const started = Date.now();
    const worker = async () => {
        while (i < rows.length) {
            const c = rows[i++];
            try {
                const r = await geocodeOne(c);
                tally[r.precision]++;
                await save(c, r);
                if (DRY && done < 60) console.log(`${r.precision.padEnd(8)} ${c.name.slice(0, 34).padEnd(34)} => ${(r.matched || '').slice(0, 60)}`);
            } catch (e) {
                tally.error++;
            }
            if (++done % 250 === 0) {
                const rate = done / ((Date.now() - started) / 1000);
                console.log(`${done}/${rows.length}  ${JSON.stringify(tally)}  ${rate.toFixed(1)}/s`);
            }
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log('Done', JSON.stringify(tally));
    await pool.end();
})();
