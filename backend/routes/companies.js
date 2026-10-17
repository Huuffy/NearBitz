const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { geocodeAddress } = require('../services/geocode');
const { authenticateToken, requireRole, requireCompanyAccess, optionalAuth } = require('../middleware/auth');

/* GET /api/companies — search/list */
router.get('/', optionalAuth, async (req, res) => {
    try {
        const { q, city, industry_id, limit = 20, offset = 0 } = req.query;
        const params = [];
        const where = ['c.is_active = true'];

        if (q) {
            params.push(q);
            where.push(`(c.name ILIKE $${params.length} OR c.name % $${params.length})`);
        }
        if (city) {
            params.push(`%${city}%`);
            where.push(`c.city ILIKE $${params.length}`);
        }
        if (industry_id) {
            params.push(parseInt(industry_id));
            where.push(`EXISTS (SELECT 1 FROM company_industries ci WHERE ci.company_id = c.id AND ci.industry_id = $${params.length})`);
        }

        params.push(parseInt(limit), parseInt(offset));
        const result = await pool.query(
            `SELECT c.id, c.name, c.slug, c.logo_url, c.city, c.state,
                    c.is_verified, c.feed_active, c.follower_count, c.post_count
             FROM companies c
             WHERE ${where.join(' AND ')}
             ORDER BY c.feed_visibility_score DESC, c.follower_count DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        res.json({ success: true, companies: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch companies' });
    }
});

/* GET /api/companies/categories — product taxonomy (must be before /:id) */
router.get('/categories', async (req, res) => {
    try {
        const rows = await pool.query(
            `SELECT id, name, slug, level, parent_id, keywords
             FROM product_categories
             ORDER BY level ASC, name ASC`
        );
        res.json({ success: true, categories: rows.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch categories' });
    }
});

/* GET /api/companies/:id */
router.get('/:id', optionalAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [companyRes, buyRes, sellRes, productsRes, postsRes] = await Promise.all([
            pool.query(
                `SELECT c.*,
                        ARRAY(SELECT i.id   FROM industries i JOIN company_industries ci ON ci.industry_id = i.id WHERE ci.company_id = c.id) AS industry_ids,
                        ARRAY(SELECT i.name FROM industries i JOIN company_industries ci ON ci.industry_id = i.id WHERE ci.company_id = c.id) AS industry_names,
                        (SELECT i.name FROM industries i JOIN company_industries ci ON ci.industry_id = i.id WHERE ci.company_id = c.id LIMIT 1) AS primary_industry
                 FROM companies c WHERE c.id = $1 AND c.is_active = true`,
                [id]
            ),
            // HSN categories this company buys
            pool.query(
                `SELECT pc.id, pc.name, pc.hsn_code, pc.level, cpb.product_label
                 FROM company_products_buy cpb
                 JOIN product_categories pc ON pc.id = cpb.category_id
                 WHERE cpb.company_id = $1
                 ORDER BY pc.level DESC, pc.name ASC`,
                [id]
            ),
            // HSN categories this company sells
            pool.query(
                `SELECT pc.id, pc.name, pc.hsn_code, pc.level, cps.product_label
                 FROM company_products_sell cps
                 JOIN product_categories pc ON pc.id = cps.category_id
                 WHERE cps.company_id = $1
                 ORDER BY pc.level DESC, pc.name ASC`,
                [id]
            ),
            // Products catalogue
            pool.query(
                `SELECT p.id, p.name, p.description, p.price_min, p.price_max, p.unit, p.sku,
                        pc.name AS category_name
                 FROM products p
                 LEFT JOIN product_categories pc ON pc.id = p.category_id
                 WHERE p.company_id = $1 AND p.is_active = true
                 ORDER BY p.display_order ASC, p.name ASC
                 LIMIT 50`,
                [id]
            ),
            // Recent posts
            pool.query(
                `SELECT id, post_type, title, content, like_count, comment_count, published_at
                 FROM posts
                 WHERE company_id = $1 AND is_published = true
                 ORDER BY published_at DESC
                 LIMIT 20`,
                [id]
            ),
        ]);

        if (!companyRes.rows.length) return res.status(404).json({ success: false, error: 'Company not found' });

        const company = companyRes.rows[0];
        delete company.geom;
        company.pinned = ['house', 'street'].includes(company.geocode_precision);
        if (!company.pinned) { company.latitude = null; company.longitude = null; }
        const sd = company.source_data || {};
        company.mca = {
            cin: sd.cin || null,
            class: sd.class || null,
            incorporated: sd.incorporated || null,
            activity: sd.principal_business_activity || null,
            paid_up_capital: company.paid_up_capital == null ? null : Number(company.paid_up_capital),
        };
        delete company.source_data;

        // Build clean HSN tag labels for buy/sell (same format as map pins)
        // "7213 — BARS AND RODS, HOT-ROLLED, IN …" → "7213 · Bars and rods, hot-rolled"
        const fmtHsn = (row) => {
            if (row.product_label) return row.product_label;
            const desc = (row.name.split(' — ')[1] || row.name).toLowerCase().replace(/^\d{2,8}\s*/, '');
            let short = desc.split(/[;:(]/)[0].split(',').slice(0, 2).join(',').trim();
            short = short.replace(/^[\s\-–—:.,]+/, '');
            if (short.length > 34) short = `${short.slice(0, 33).trimEnd()}…`;
            short = short.charAt(0).toUpperCase() + short.slice(1);
            return row.hsn_code ? `${row.hsn_code} · ${short}` : short;
        };

        company.buy_categories  = buyRes.rows.map(fmtHsn);
        company.sell_categories = sellRes.rows.map(fmtHsn);
        company.buy_category_ids  = buyRes.rows.map(r => r.id);
        company.sell_category_ids = sellRes.rows.map(r => r.id);
        company.buy_hsn  = buyRes.rows.map(r => r.hsn_code).filter(Boolean);
        company.sell_hsn = sellRes.rows.map(r => r.hsn_code).filter(Boolean);
        company.products = productsRes.rows;
        company.posts    = postsRes.rows;

        res.json({ success: true, data: company });
    } catch (err) {
        console.error('Company detail error:', err.message);
        res.status(500).json({ success: false, error: 'Failed to fetch company' });
    }
});

/* GET /api/companies/slug/:slug */
router.get('/slug/:slug', optionalAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.*,
                    ARRAY(SELECT i.name FROM industries i JOIN company_industries ci ON ci.industry_id = i.id WHERE ci.company_id = c.id) AS industry_names
             FROM companies c WHERE c.slug = $1 AND c.is_active = true`,
            [req.params.slug]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Company not found' });
        const company = result.rows[0];
        delete company.geom;
        res.json({ success: true, company });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch company' });
    }
});

/* POST /api/companies — register a new company (any authenticated user) */
router.post('/', authenticateToken, async (req, res) => {
    try {
        const {
            name, description, phone, email, gstin,
            address, city, state, pincode, latitude, longitude,
            founded_year, industry_slugs = [], industry_ids = [],
            products_sell_ids = [],   // category IDs of what company sells
            products_buy_ids  = [],   // category IDs of what company buys
            products_sell_labels = [], // optional human labels per category
            products_buy_labels  = [],
        } = req.body;

        if (!name || !city) return res.status(400).json({ success: false, error: 'name and city are required' });

        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now().toString(36);

        const website = req.body.website || req.body.website_url || null;
        // A user-placed point is trusted as house-level; otherwise only an address-level geocode is stored.
        let lat = latitude, lon = longitude, precision = lat && lon ? 'house' : null;
        if ((!lat || !lon) && address) {
            const geo = await geocodeAddress(`${address}, ${city}, ${state || ''}, ${pincode || ''}, India`);
            if (geo) { lat = geo.lat; lon = geo.lon; precision = geo.precision; }
        }

        const result = await pool.query(
            `INSERT INTO companies
                (name, slug, description, website, phone, email, gstin,
                 address, city, state, pincode, latitude, longitude, geom,
                 founded_year, geocode_source, geocode_precision, source, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,
                 CASE WHEN $12 IS NOT NULL AND $13 IS NOT NULL
                      THEN ST_SetSRID(ST_MakePoint($13::float, $12::float), 4326)::geography
                      ELSE NULL END,
                 $14, CASE WHEN $15::text IS NULL THEN NULL ELSE 'photon' END, $15, 'self_registered', NOW(), NOW())
             RETURNING id, name, slug`,
            [name, slug, description || null, website, phone || null, email || null,
             gstin || null, address || null, city, state || null, pincode || null,
             lat || null, lon || null, founded_year || null, precision]
        );

        const company = result.rows[0];
        const dbClient = await pool.connect();
        try {
            await dbClient.query('BEGIN');

            // Resolve industry IDs from slugs if provided
            let resolvedIndustryIds = [...industry_ids];
            if (industry_slugs.length) {
                const r = await dbClient.query(
                    `SELECT id FROM industries WHERE slug = ANY($1)`,
                    [industry_slugs]
                );
                resolvedIndustryIds = [...new Set([...resolvedIndustryIds, ...r.rows.map(x => x.id)])];
            }

            if (resolvedIndustryIds.length) {
                for (const iid of resolvedIndustryIds) {
                    await dbClient.query(
                        `INSERT INTO company_industries (company_id, industry_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                        [company.id, iid]
                    );
                }
            }

            // Products company SELLS
            for (let i = 0; i < products_sell_ids.length; i++) {
                const catId = products_sell_ids[i];
                const label = products_sell_labels[i] || null;
                await dbClient.query(
                    `INSERT INTO company_products_sell (id, company_id, category_id, product_label)
                     VALUES (gen_random_uuid(), $1, $2, $3)
                     ON CONFLICT (company_id, category_id) DO UPDATE SET product_label = EXCLUDED.product_label`,
                    [company.id, catId, label]
                );
            }

            // Products company BUYS
            for (let i = 0; i < products_buy_ids.length; i++) {
                const catId = products_buy_ids[i];
                const label = products_buy_labels[i] || null;
                await dbClient.query(
                    `INSERT INTO company_products_buy (id, company_id, category_id, product_label)
                     VALUES (gen_random_uuid(), $1, $2, $3)
                     ON CONFLICT (company_id, category_id) DO UPDATE SET product_label = EXCLUDED.product_label`,
                    [company.id, catId, label]
                );
            }

            // Upgrade user role to company_admin, link to this company
            await dbClient.query(
                `UPDATE users SET company_id = $1, role = 'company_admin', updated_at = NOW() WHERE id = $2`,
                [company.id, req.user.sub]
            );

            await dbClient.query('COMMIT');
        } catch (e) {
            await dbClient.query('ROLLBACK');
            throw e;
        } finally {
            dbClient.release();
        }

        res.status(201).json({ success: true, company });
    } catch (err) {
        console.error('Create company error:', err);
        res.status(500).json({ success: false, error: 'Failed to create company' });
    }
});

/* PUT /api/companies/:id */
router.put('/:id', authenticateToken, requireCompanyAccess, async (req, res) => {
    try {
        const {
            name, description, phone, email, gstin,
            address, city, state, pincode, latitude, longitude,
            founded_year, employee_band, industry_ids
        } = req.body;
        const website = req.body.website || req.body.website_url || null;

        let lat = latitude, lon = longitude, precision = lat && lon ? 'house' : null;
        if (address && city && (!lat || !lon)) {
            const geo = await geocodeAddress(`${address}, ${city}, ${state || ''}, ${pincode || ''}, India`);
            if (geo) { lat = geo.lat; lon = geo.lon; precision = geo.precision; }
        }

        await pool.query(
            `UPDATE companies SET
                name = COALESCE($2, name),
                description = COALESCE($3, description),
                website = COALESCE($4, website),
                phone = COALESCE($5, phone),
                email = COALESCE($6, email),
                gstin = COALESCE($7, gstin),
                address = COALESCE($8, address),
                city = COALESCE($9, city),
                state = COALESCE($10, state),
                pincode = COALESCE($11, pincode),
                latitude = COALESCE($12, latitude),
                longitude = COALESCE($13, longitude),
                geom = CASE WHEN $12 IS NOT NULL AND $13 IS NOT NULL
                            THEN ST_SetSRID(ST_MakePoint($13::float, $12::float), 4326)::geography
                            ELSE geom END,
                founded_year = COALESCE($14, founded_year),
                employee_band = COALESCE($15, employee_band),
                geocode_precision = COALESCE($16, geocode_precision),
                geocode_source = CASE WHEN $16::text IS NOT NULL THEN 'photon' ELSE geocode_source END,
                updated_at = NOW()
             WHERE id = $1`,
            [req.params.id, name || null, description || null, website,
             phone || null, email || null, gstin || null, address || null, city || null,
             state || null, pincode || null, lat || null, lon || null,
             founded_year || null, employee_band || null, precision]
        );

        if (Array.isArray(industry_ids)) {
            await pool.query('DELETE FROM company_industries WHERE company_id = $1', [req.params.id]);
            if (industry_ids.length) {
                const vals = industry_ids.map((iid, idx) => `($1, $${idx + 2})`).join(',');
                await pool.query(
                    `INSERT INTO company_industries (company_id, industry_id) VALUES ${vals} ON CONFLICT DO NOTHING`,
                    [req.params.id, ...industry_ids]
                );
            }
        }

        const updated = await pool.query('SELECT id, name, slug, city, updated_at FROM companies WHERE id = $1', [req.params.id]);
        res.json({ success: true, company: updated.rows[0] });
    } catch (err) {
        console.error('Update company error:', err);
        res.status(500).json({ success: false, error: 'Failed to update company' });
    }
});

/* GET /api/companies/:id/products */
router.get('/:id/products', optionalAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT p.*,
                    ARRAY(SELECT pm.url FROM product_media pm WHERE pm.product_id = p.id AND pm.media_type = 'image' ORDER BY pm.display_order LIMIT 1) AS image_urls
             FROM products p
             WHERE p.company_id = $1 AND p.is_active = true
             ORDER BY p.display_order ASC, p.created_at DESC`,
            [req.params.id]
        );
        res.json({ success: true, products: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch products' });
    }
});

/* POST /api/companies/:id/products */
router.post('/:id/products', authenticateToken, requireCompanyAccess, async (req, res) => {
    try {
        const { name, description, sku, price_min, price_max, currency = 'INR', unit, min_order_qty, category_id } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Product name required' });

        const result = await pool.query(
            `INSERT INTO products (company_id, name, description, sku, price_min, price_max, currency, unit, min_order_qty, category_id, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())
             RETURNING id, name, sku`,
            [req.params.id, name, description || null, sku || null,
             price_min || null, price_max || null, currency, unit || null,
             min_order_qty || null, category_id || null]
        );

        await pool.query('UPDATE companies SET updated_at = NOW() WHERE id = $1', [req.params.id]);
        res.status(201).json({ success: true, product: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to create product' });
    }
});

/* PUT /api/companies/:id/products/:productId */
router.put('/:id/products/:productId', authenticateToken, requireCompanyAccess, async (req, res) => {
    try {
        const { name, description, sku, price_min, price_max, currency, unit, min_order_qty, category_id, is_active } = req.body;
        await pool.query(
            `UPDATE products SET
                name = COALESCE($3, name),
                description = COALESCE($4, description),
                sku = COALESCE($5, sku),
                price_min = COALESCE($6, price_min),
                price_max = COALESCE($7, price_max),
                currency = COALESCE($8, currency),
                unit = COALESCE($9, unit),
                min_order_qty = COALESCE($10, min_order_qty),
                category_id = COALESCE($11, category_id),
                is_active = COALESCE($12, is_active),
                updated_at = NOW()
             WHERE id = $2 AND company_id = $1`,
            [req.params.id, req.params.productId, name || null, description || null,
             sku || null, price_min || null, price_max || null, currency || null,
             unit || null, min_order_qty || null, category_id || null,
             is_active !== undefined ? is_active : null]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update product' });
    }
});

/* DELETE /api/companies/:id/products/:productId */
router.delete('/:id/products/:productId', authenticateToken, requireCompanyAccess, async (req, res) => {
    try {
        await pool.query(
            'UPDATE products SET is_active = false, updated_at = NOW() WHERE id = $1 AND company_id = $2',
            [req.params.productId, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to delete product' });
    }
});

module.exports = router;
