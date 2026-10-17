const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { getRoute, getTripOrder } = require('../services/routing');
const { optionalAuth, authenticateToken } = require('../middleware/auth');

/* ─── helpers ─────────────────────────────────────────────────── */

function parseCoords(lat, lon, radius) {
    const latF = parseFloat(lat);
    const lonF = parseFloat(lon);
    const radF = parseFloat(radius);
    if (isNaN(latF) || isNaN(lonF)) return null;
    return { latF, lonF, radF: isNaN(radF) ? 10 : radF };
}

/* ─── GET /api/map/all-pins ──────────────────────────────────── */
/*
 * Lightweight: returns ONLY id, name, lat, lon, city, is_verified, feed_active
 * for ALL active geocoded companies. No joins, no aggregations.
 * Designed for the initial map load — fast, small, cache-friendly.
 * Typical: 22k rows ≈ 2-3MB JSON, <1s query.
 */
router.get('/all-pins', optionalAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id,
                    c.name,
                    c.city,
                    c.state,
                    ROUND(c.latitude::numeric,  6) AS lat,
                    ROUND(c.longitude::numeric, 6) AS lon,
                    c.is_verified,
                    c.feed_active,
                    COALESCE(c.primary_industry_id,
                             (SELECT ci.industry_id FROM company_industries ci
                              WHERE ci.company_id = c.id ORDER BY ci.industry_id LIMIT 1)) AS industry_id,
                    c.paid_up_capital,
                    c.pin_tier
             FROM companies c
             WHERE c.is_active = true
               AND c.geocode_precision IN ('house', 'street')
               AND c.latitude  IS NOT NULL
               AND c.longitude IS NOT NULL
             ORDER BY c.paid_up_capital DESC NULLS LAST`
        );
        const cols = ['id','name','city','state','lat','lon','is_verified','feed_active','industry_id','capital','tier'];
        const rows = result.rows.map(r => [
            r.id, r.name, r.city, r.state,
            parseFloat(r.lat), parseFloat(r.lon),
            r.is_verified, r.feed_active, r.industry_id,
            r.paid_up_capital == null ? null : Number(r.paid_up_capital), r.pin_tier,
        ]);
        const total = await pool.query(`SELECT COUNT(*)::int AS n FROM companies WHERE is_active`);
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.setHeader('X-Total-Companies', String(total.rows[0].n));
        res.json({ success: true, cols, rows, total_companies: total.rows[0].n });
    } catch (err) {
        console.error('all-pins error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load pins' });
    }
});

/* ─── GET /api/map/my-client-pins ────────────────────────────── */
/* The signed-in salesman's geocoded ERP clients. Kept separate from all-pins so that stays publicly cacheable. */
router.get('/my-client-pins', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, customer_name AS name, address, city, state, phone,
                    latitude AS lat, longitude AS lon,
                    last_order_date, last_order_amount, last_product_raw
             FROM salesman_clients
             WHERE owner_user_id = $1
               AND latitude IS NOT NULL AND longitude IS NOT NULL`,
            [req.user.sub]
        );
        res.setHeader('Cache-Control', 'private, no-store');
        res.json({ success: true, data: result.rows });
    } catch (err) {
        console.error('my-client-pins error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load client pins' });
    }
});

/* ─── GET /api/map/nearby ─────────────────────────────────────── */
/*
 * Returns company pins near a point.
 * Uses company_locations if migration 009 has run, falls back to companies.geom.
 * Each distinct office is its own pin — one company with 3 branches = 3 pins.
 */
router.get('/nearby', optionalAuth, async (req, res) => {
    try {
        const coords = parseCoords(req.query.lat, req.query.lon, req.query.radius_km);
        if (!coords) return res.status(400).json({ success: false, error: 'lat and lon required' });
        const { latF, lonF, radF } = coords;
        const limitN = Math.min(parseInt(req.query.limit) || 100, 500);

        const params = [lonF, latF, radF * 1000, limitN];
        const whereParts = ['c.is_active = true', "c.geocode_precision IN ('house','street')"];

        if (req.query.verified === 'true') whereParts.push('c.is_verified = true');
        if (req.query.feed_active === 'true') whereParts.push('c.feed_active = true');
        if (req.query.industry) {
            params.push(parseInt(req.query.industry));
            whereParts.push(`EXISTS (
                SELECT 1 FROM company_industries ci
                WHERE ci.company_id = c.id AND ci.industry_id = $${params.length}
            )`);
        }
        // category filter — exact match (used when browsing by category)
        if (req.query.category) {
            params.push(parseInt(req.query.category));
            whereParts.push(`(
                EXISTS (SELECT 1 FROM company_products_buy  cpb WHERE cpb.company_id = c.id AND cpb.category_id = $${params.length})
                OR
                EXISTS (SELECT 1 FROM company_products_sell cps WHERE cps.company_id = c.id AND cps.category_id = $${params.length})
            )`);
        }

        // salesman_match — hierarchical buy-side filter.
        // If the salesman passes their sell category IDs (or the API resolves them from their profile),
        // we find companies that BUY any of those categories OR any ANCESTOR category.
        // This means: salesman sells "pump impellers" (HSN 8413.91) → matches companies buying
        //   "pump impellers" (exact) OR "pumps" (parent heading) OR "Chapter 84 — Machinery" (chapter).
        // Comma-separated list of category IDs.
        if (req.query.salesman_sell_ids) {
            const rawIds = String(req.query.salesman_sell_ids)
                .split(',')
                .map(s => parseInt(s.trim()))
                .filter(n => !isNaN(n));
            if (rawIds.length) {
                params.push(rawIds);
                whereParts.push(`
                    EXISTS (
                        WITH RECURSIVE sell_ancestors AS (
                            -- Start: the exact categories the salesman sells
                            SELECT id, parent_id FROM product_categories
                            WHERE id = ANY($${params.length}::int[])
                          UNION ALL
                            -- Walk UP: include broader parent categories
                            SELECT pc.id, pc.parent_id FROM product_categories pc
                            JOIN sell_ancestors sa ON pc.id = sa.parent_id
                        )
                        SELECT 1 FROM company_products_buy cpb
                        WHERE cpb.company_id = c.id
                          AND cpb.category_id IN (SELECT id FROM sell_ancestors)
                    )
                `);
            }
        }

        const whereSQL = whereParts.join(' AND ');

        /*
         * Strategy: prefer company_locations pins (post-migration-009).
         * UNION with companies fallback for rows that have no location rows yet.
         * Both branches produce the same column set.
         */
        const query = `
            WITH user_point AS (
                SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS pt
            ),
            -- Branch 1: pins from company_locations (one row per office)
            loc_pins AS (
                SELECT
                    c.id            AS company_id,
                    cl.id           AS location_id,
                    cl.location_type::text,
                    cl.label        AS location_label,
                    c.name,
                    c.slug,
                    c.logo_url,
                    COALESCE(cl.city,  c.city)  AS city,
                    COALESCE(cl.state, c.state) AS state,
                    COALESCE(cl.address, c.address) AS address,
                    c.phone,
                    c.is_verified,
                    c.feed_active,
                    c.feed_visibility_score,
                    cl.latitude     AS lat,
                    cl.longitude    AS lon,
                    cl.geom,
                    ST_Distance(cl.geom, (SELECT pt FROM user_point)) / 1000 AS distance_km
                FROM company_locations cl
                JOIN companies c ON c.id = cl.company_id
                WHERE cl.geom IS NOT NULL
                  AND ST_DWithin(cl.geom, (SELECT pt FROM user_point), $3)
                  AND ${whereSQL}
            ),
            -- Branch 2: companies that have no location rows (fallback)
            direct_pins AS (
                SELECT
                    c.id            AS company_id,
                    NULL::uuid      AS location_id,
                    'headquarters'  AS location_type,
                    NULL            AS location_label,
                    c.name,
                    c.slug,
                    c.logo_url,
                    c.city,
                    c.state,
                    c.address,
                    c.phone,
                    c.is_verified,
                    c.feed_active,
                    c.feed_visibility_score,
                    c.latitude      AS lat,
                    c.longitude     AS lon,
                    c.geom,
                    ST_Distance(c.geom, (SELECT pt FROM user_point)) / 1000 AS distance_km
                FROM companies c
                WHERE c.geom IS NOT NULL
                  AND ST_DWithin(c.geom, (SELECT pt FROM user_point), $3)
                  AND ${whereSQL}
                  AND NOT EXISTS (
                      SELECT 1 FROM company_locations cl2
                      WHERE cl2.company_id = c.id
                  )
            ),
            combined AS (
                SELECT * FROM loc_pins
                UNION ALL
                SELECT * FROM direct_pins
            )
            SELECT
                combined.*,
                combined.distance_km * (1.0 / GREATEST(combined.feed_visibility_score, 0.1)) AS rank_score,
                -- Products this company buys — return "HSN · Short label" e.g. "8413 · Pumps"
                COALESCE((
                    SELECT array_agg(DISTINCT COALESCE(
                        cpb.product_label,
                        pc.hsn_code || ' · ' || LEFT(SPLIT_PART(pc.name, ' — ', 2), 40)
                    ))
                    FROM company_products_buy cpb
                    JOIN product_categories pc ON pc.id = cpb.category_id
                    WHERE cpb.company_id = combined.company_id
                    LIMIT 5
                ), '{}') AS products_buy,
                -- Products this company sells
                COALESCE((
                    SELECT array_agg(DISTINCT COALESCE(
                        cps.product_label,
                        pc.hsn_code || ' · ' || LEFT(SPLIT_PART(pc.name, ' — ', 2), 40)
                    ))
                    FROM company_products_sell cps
                    JOIN product_categories pc ON pc.id = cps.category_id
                    WHERE cps.company_id = combined.company_id
                    LIMIT 5
                ), '{}') AS products_sell,
                -- Industries
                COALESCE((
                    SELECT array_agg(i.name ORDER BY i.name)
                    FROM industries i
                    JOIN company_industries ci ON ci.industry_id = i.id
                    WHERE ci.company_id = combined.company_id
                    LIMIT 3
                ), '{}') AS industries
            FROM combined
            ORDER BY rank_score ASC
            LIMIT $4
        `;

        const result = await pool.query(query, params);

        // Merge in salesman's own clients if authenticated
        let myClients = [];
        if (req.user) {
            try {
                const sc = await pool.query(
                    `SELECT
                        id, customer_name AS name, address, city, state, phone,
                        latitude AS lat, longitude AS lon,
                        last_order_date, last_product_raw, last_order_amount,
                        ST_Distance(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography) / 1000 AS distance_km
                     FROM salesman_clients
                     WHERE owner_user_id = $3
                       AND geom IS NOT NULL
                       AND ST_DWithin(geom, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $4)
                     ORDER BY distance_km ASC LIMIT 200`,
                    [lonF, latF, req.user.sub, radF * 1000]
                );
                myClients = sc.rows.map(r => ({ ...r, source: 'my_client' }));
            } catch (_) { /* salesman_clients table may not exist yet */ }
        }

        const companies = result.rows.map(r => ({ ...r, source: 'company' }));
        res.json({
            success: true,
            data: [...companies, ...myClients],
            count: companies.length + myClients.length,
        });
    } catch (err) {
        console.error('Map nearby error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch nearby companies' });
    }
});

/* ─── GET /api/map/nearby/for-me ─────────────────────────────── */
/*
 * Same as /nearby but auto-injects the authed salesman's sell categories
 * as the salesman_sell_ids filter. The client doesn't need to pass them.
 * If the salesman has no products set, falls back to unfiltered nearby.
 */
router.get('/nearby/for-me', authenticateToken, async (req, res) => {
    try {
        const sellRows = await pool.query(
            'SELECT category_id FROM salesman_products_sell WHERE user_id = $1',
            [req.user.sub]
        );
        const sellIds = sellRows.rows.map(r => r.category_id);
        if (sellIds.length) {
            req.query.salesman_sell_ids = sellIds.join(',');
        }
        // Delegate to the main /nearby handler
        return router.handle({ ...req, url: `/nearby?${new URLSearchParams(req.query)}`, path: '/nearby' }, res, () => {});
    } catch (err) {
        console.error('Map nearby/for-me error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch nearby companies' });
    }
});

/* ─── GET /api/map/category-companies?category_id=&kind=buy|sell ─ */
/* Company ids that buy or sell a category (and its sub-headings), for filtering map pins client-side. */
router.get('/category-companies', optionalAuth, async (req, res) => {
    const categoryId = parseInt(req.query.category_id);
    const kind = req.query.kind === 'sell' ? 'sell' : 'buy';
    if (isNaN(categoryId)) return res.status(400).json({ success: false, error: 'category_id required' });
    try {
        const table = kind === 'sell' ? 'company_products_sell' : 'company_products_buy';
        const result = await pool.query(
            `WITH RECURSIVE tree AS (
                 SELECT id FROM product_categories WHERE id = $1
                 UNION ALL
                 SELECT pc.id FROM product_categories pc JOIN tree t ON pc.parent_id = t.id
             )
             SELECT DISTINCT company_id FROM ${table} WHERE category_id IN (SELECT id FROM tree)`,
            [categoryId]
        );
        res.json({ success: true, ids: result.rows.map(r => r.company_id) });
    } catch (err) {
        console.error('category-companies error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to load companies for category' });
    }
});

/* ─── GET /api/map/search ─────────────────────────────────────── */
/*
 * Typo-tolerant search over company names, product categories (name / keyword / HSN prefix)
 * and places. Results are grouped: { companies, products, places }.
 *
 * Company score:
 *   text  = 0.6*word_similarity² + 0.3*prefix + 0.5*exact + 0.25*product match
 *   final = text * (0.75 + 0.25/(1 + km/50)) * feed_visibility_score
 * Squaring similarity suppresses weak substring hits ("cement" in "manageMENT");
 * distance only breaks ties so a far exact match still beats a near partial one.
 */
const shortHsnLabel = (name, hsn) => {
    const desc = (name.split(' — ')[1] || name).toLowerCase();
    const text = desc.charAt(0).toUpperCase() + desc.slice(1);
    return { hsn, label: text.length > 60 ? `${text.slice(0, 57)}…` : text };
};

router.get('/search', optionalAuth, async (req, res) => {
    const term = String(req.query.q || '').trim().slice(0, 80);
    if (term.length < 2) {
        return res.status(400).json({ success: false, error: 'q must be at least 2 characters' });
    }
    const latF = parseFloat(req.query.lat);
    const lonF = parseFloat(req.query.lon);
    const hasPoint = !isNaN(latF) && !isNaN(lonF);
    const limitN = Math.min(parseInt(req.query.limit) || 20, 50);
    const isHsn = /^\d{2,8}$/.test(term);

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query("SET LOCAL pg_trgm.word_similarity_threshold = 0.45");

        // 1. Product categories: HSN prefix, or name / keyword match.
        const prodRes = await client.query(
            `SELECT pc.id, pc.name, pc.hsn_code,
                    CASE WHEN $2 THEN 1.0 ELSE word_similarity($1, pc.name) END AS score
             FROM product_categories pc
             WHERE pc.hsn_code IS NOT NULL
               AND ( ($2 AND pc.hsn_code LIKE $1 || '%')
                  OR (NOT $2 AND ($1 <% pc.name OR pc.keywords @> ARRAY[lower($1)])) )
             ORDER BY score DESC, length(pc.hsn_code) ASC
             LIMIT 12`,
            [term, isHsn]
        );
        const prodIds = prodRes.rows.map(r => r.id);

        // 2. Candidate companies: by name, and by buying/selling a matched category.
        // Legal-form words appear in nearly every name, so they're dropped before fuzzy matching.
        const nameTerm = term.replace(/\b(private|pvt|limited|ltd|llp|company|co|india|the)\b\.?/gi, ' ')
            .replace(/\s+/g, ' ').trim() || term;
        const nameRes = await client.query(
            `SELECT id FROM companies
             WHERE is_active
               AND ($1 <% name OR name ILIKE $2 || '%')
             ORDER BY word_similarity($1, name) DESC
             LIMIT 300`,
            [nameTerm, term]
        );
        let prodCompanyRes = { rows: [] };
        if (prodIds.length) {
            prodCompanyRes = await client.query(
                `SELECT company_id AS id, bool_or(kind = 'buy') AS buys, bool_or(kind = 'sell') AS sells
                 FROM (
                     SELECT company_id, 'buy' AS kind FROM company_products_buy WHERE category_id = ANY($1)
                     UNION ALL
                     SELECT company_id, 'sell' FROM company_products_sell WHERE category_id = ANY($1)
                 ) x
                 GROUP BY company_id
                 LIMIT 600`,
                [prodIds]
            );
        }
        const productHit = new Map(prodCompanyRes.rows.map(r => [r.id, r]));
        const candidateIds = [...new Set([...nameRes.rows.map(r => r.id), ...productHit.keys()])];

        // 3. Score candidates.
        let companies = [];
        if (candidateIds.length) {
            const scored = await client.query(
                `SELECT c.id, c.name, c.city, c.state, c.phone, c.logo_url,
                        c.is_verified, c.feed_active, c.paid_up_capital,
                        (c.geocode_precision IN ('house','street')) AS pinned,
                        c.latitude AS lat, c.longitude AS lon,
                        GREATEST(c.feed_visibility_score, 0.1) AS vis,
                        word_similarity($2, c.name) AS ws,
                        COALESCE(c.primary_industry_id,
                            (SELECT ci.industry_id FROM company_industries ci
                             WHERE ci.company_id = c.id ORDER BY ci.industry_id LIMIT 1)) AS industry_id,
                        ${hasPoint
                            ? 'ST_Distance(c.geom, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography) / 1000'
                            : 'NULL::float'} AS distance_km
                 FROM companies c
                 WHERE c.id = ANY($1) AND c.is_active`,
                hasPoint ? [candidateIds, nameTerm, lonF, latF] : [candidateIds, nameTerm]
            );
            companies = scored.rows.map(r => {
                const hit = productHit.get(r.id);
                const dist = r.pinned && r.distance_km != null ? Number(r.distance_km) : null;
                const lname = r.name.toLowerCase();
                const prefix = lname.startsWith(term.toLowerCase()) || lname.startsWith(nameTerm.toLowerCase());
                const exact = lname === term.toLowerCase();
                const text = 0.6 * r.ws * r.ws + (prefix ? 0.3 : 0) + (exact ? 0.5 : 0) + (hit ? 0.25 : 0);
                const near = dist == null ? 0.85 : 0.75 + 0.25 / (1 + dist / 50);
                return {
                    id: r.id, name: r.name, city: r.city, state: r.state, phone: r.phone, logo_url: r.logo_url,
                    is_verified: r.is_verified, feed_active: r.feed_active, industry_id: r.industry_id,
                    capital: r.paid_up_capital == null ? null : Number(r.paid_up_capital),
                    // Only address-level coordinates leave the server; the rest have no real position yet.
                    lat: r.pinned ? r.lat : null, lon: r.pinned ? r.lon : null, pinned: !!r.pinned,
                    distance_km: dist,
                    match: hit ? (hit.buys ? 'buys' : 'sells') : 'name',
                    score: text * near * Number(r.vis),
                };
            }).sort((a, b) => (b.score - a.score) || ((b.capital ?? 0) - (a.capital ?? 0))).slice(0, limitN);
        }

        // 4. Product suggestions with how many mapped companies buy / sell each.
        let products = [];
        if (prodIds.length) {
            const counts = await client.query(
                `SELECT pc.id,
                        (SELECT COUNT(*) FROM company_products_buy  b WHERE b.category_id = pc.id) AS buyers,
                        (SELECT COUNT(*) FROM company_products_sell s WHERE s.category_id = pc.id) AS sellers
                 FROM product_categories pc WHERE pc.id = ANY($1)`,
                [prodIds.slice(0, 6)]
            );
            const byId = new Map(counts.rows.map(r => [r.id, r]));
            products = prodRes.rows.slice(0, 6)
                .map(p => ({
                    id: p.id,
                    ...shortHsnLabel(p.name, p.hsn_code),
                    buyers: Number(byId.get(p.id)?.buyers || 0),
                    sellers: Number(byId.get(p.id)?.sellers || 0),
                }))
                .filter(p => p.buyers + p.sellers > 0);
        }

        // 5. Places: cities that have mapped companies.
        const placeRes = isHsn ? { rows: [] } : await client.query(
            `SELECT city, initcap(state) AS state, COUNT(*)::int AS companies,
                    AVG(latitude) AS lat, AVG(longitude) AS lon, MAX(ws) AS ws
             FROM (
                 -- "PUNE - 412 208", "MUMBAI-9." and "Pune" all collapse to "Pune"
                 SELECT initcap(lower(trim(regexp_replace(city, '[-,.(0-9].*$', '')))) AS city,
                        lower(state) AS state, latitude, longitude,
                        word_similarity($1, city) AS ws
                 FROM companies
                 WHERE is_active AND latitude IS NOT NULL AND city IS NOT NULL
                   AND ($1 <% city OR city ILIKE $1 || '%')
             ) x
             WHERE city <> ''
             GROUP BY city, state
             ORDER BY ws DESC, companies DESC
             LIMIT 4`,
            [term]
        );

        await client.query('COMMIT');
        res.json({
            success: true,
            companies,
            products,
            places: placeRes.rows.map(p => ({ ...p, lat: Number(p.lat), lon: Number(p.lon) })),
            data: companies, // legacy shape
        });
    } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error('Map search error:', err.message);
        res.status(500).json({ success: false, error: 'Search failed' });
    } finally {
        client.release();
    }
});

/* ─── POST /api/map/route ─────────────────────────────────────── */
router.post('/route', optionalAuth, async (req, res) => {
    try {
        const { from, to, mode = 'driving' } = req.body;
        if (!from || !to) return res.status(400).json({ success: false, error: 'from and to required' });
        const route = await getRoute(from, to, mode);
        res.json({ success: true, route });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/* ─── POST /api/map/trip ─────────────────────────────────────── */
router.post('/trip', authenticateToken, async (req, res) => {
    try {
        const { waypoints } = req.body;
        if (!Array.isArray(waypoints) || waypoints.length < 2) {
            return res.status(400).json({ success: false, error: 'At least 2 waypoints required' });
        }
        const ordered = await getTripOrder(waypoints);
        res.json({ success: true, waypoints: ordered });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
