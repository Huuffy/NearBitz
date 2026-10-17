const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticateToken } = require('../middleware/auth');

/* GET /api/users/me */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.email, u.full_name, u.role, u.phone, u.avatar_url,
                    u.is_active, u.last_seen_at, u.created_at,
                    c.id AS company_id, c.name AS company_name, c.slug AS company_slug, c.logo_url AS company_logo
             FROM users u
             LEFT JOIN companies c ON c.id = u.company_id
             WHERE u.id = $1`,
            [req.user.sub]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'User not found' });

        // Update last_seen
        pool.query('UPDATE users SET last_seen_at = NOW() WHERE id = $1', [req.user.sub]).catch(() => {});

        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch user' });
    }
});

/* PUT /api/users/me */
router.put('/me', authenticateToken, async (req, res) => {
    try {
        const { full_name, phone } = req.body;
        await pool.query(
            `UPDATE users SET
                full_name = COALESCE($2, full_name),
                phone = COALESCE($3, phone),
                updated_at = NOW()
             WHERE id = $1`,
            [req.user.sub, full_name || null, phone || null]
        );
        const result = await pool.query(
            'SELECT id, email, full_name, phone, avatar_url, role FROM users WHERE id = $1',
            [req.user.sub]
        );
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update user' });
    }
});

/* GET /api/users/me/clients — salesman's ERP clients list */
router.get('/me/clients', authenticateToken, async (req, res) => {
    try {
        const { q, limit = 30, offset = 0 } = req.query;
        const params = [req.user.sub];
        let where = 'owner_user_id = $1';

        if (q) {
            params.push(`%${q}%`);
            where += ` AND (customer_name ILIKE $${params.length} OR address ILIKE $${params.length})`;
        }

        params.push(parseInt(limit), parseInt(offset));
        const result = await pool.query(
            `SELECT id, customer_name, address, state, phone, email,
                    latitude, longitude, last_order_date, last_product_raw,
                    last_order_amount, total_amount, created_at
             FROM salesman_clients
             WHERE ${where}
             ORDER BY last_order_date DESC NULLS LAST
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );
        res.json({ success: true, clients: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch clients' });
    }
});

/* GET /api/users/me/clients/:clientId/orders */
router.get('/me/clients/:clientId/orders', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT o.* FROM salesman_client_orders o
             JOIN salesman_clients c ON c.id = o.client_id
             WHERE o.client_id = $1 AND c.owner_user_id = $2
             ORDER BY o.order_date DESC NULLS LAST`,
            [req.params.clientId, req.user.sub]
        );
        res.json({ success: true, orders: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch orders' });
    }
});

/* ─── Salesman product profile (what they sell) ──────────────────────────────
 * Stored in salesman_products_sell (migration 011).
 * Map query uses these IDs to do hierarchical buy-side matching.
 */

/* GET /api/users/me/products */
router.get('/me/products', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT sps.id, sps.category_id, sps.product_label, sps.created_at,
                    pc.name AS category_name, pc.slug AS category_slug,
                    pc.level, pc.hsn_code,
                    parent.name AS parent_name
             FROM salesman_products_sell sps
             JOIN product_categories pc ON pc.id = sps.category_id
             LEFT JOIN product_categories parent ON parent.id = pc.parent_id
             WHERE sps.user_id = $1
             ORDER BY pc.name`,
            [req.user.sub]
        );
        res.json({ success: true, products: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch products' });
    }
});

/* PUT /api/users/me/products — replace entire sell profile */
router.put('/me/products', authenticateToken, async (req, res) => {
    try {
        const { category_ids = [], product_labels = [] } = req.body;
        if (!Array.isArray(category_ids)) {
            return res.status(400).json({ success: false, error: 'category_ids must be an array' });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // Delete existing
            await client.query('DELETE FROM salesman_products_sell WHERE user_id = $1', [req.user.sub]);
            // Insert new
            for (let i = 0; i < category_ids.length; i++) {
                const catId = parseInt(category_ids[i]);
                const label = product_labels[i] || null;
                if (!isNaN(catId)) {
                    await client.query(
                        `INSERT INTO salesman_products_sell (id, user_id, category_id, product_label)
                         VALUES (gen_random_uuid(), $1, $2, $3)
                         ON CONFLICT (user_id, category_id) DO UPDATE SET product_label = EXCLUDED.product_label`,
                        [req.user.sub, catId, label]
                    );
                }
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

        const result = await pool.query(
            `SELECT sps.category_id, sps.product_label, pc.name AS category_name, pc.hsn_code
             FROM salesman_products_sell sps
             JOIN product_categories pc ON pc.id = sps.category_id
             WHERE sps.user_id = $1`,
            [req.user.sub]
        );
        res.json({ success: true, products: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to update products' });
    }
});

/* GET /api/users/me/products/search?q=pump
 * Searches product_categories by trigram similarity + full-text on HSN names/keywords.
 */
router.get('/me/products/search', authenticateToken, async (req, res) => {
    try {
        const q = (req.query.q || '').trim();
        if (q.length < 2) return res.status(400).json({ success: false, error: 'q too short' });
        const norm = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

        const results = await pool.query(
            `WITH
            trgm AS (
                SELECT pc.id, similarity(lower(pc.name), $1) AS score
                FROM product_categories pc
                WHERE lower(pc.name) % $1 AND pc.level >= 1
            ),
            fts AS (
                SELECT pc.id,
                       ts_rank(to_tsvector('english', pc.name || ' ' || array_to_string(pc.keywords, ' ')),
                               plainto_tsquery('english', $1)) AS score
                FROM product_categories pc
                WHERE to_tsvector('english', pc.name || ' ' || array_to_string(pc.keywords, ' '))
                      @@ plainto_tsquery('english', $1)
                  AND pc.level >= 1
            ),
            combined AS (
                SELECT id, MAX(score) AS score
                FROM (SELECT * FROM trgm UNION ALL SELECT * FROM fts) x
                GROUP BY id
            )
            SELECT pc.id AS category_id, pc.hsn_code, pc.name, pc.level, pc.slug,
                   parent.name AS parent_name, parent.hsn_code AS parent_hsn,
                   gp.name AS grandparent_name, c.score
            FROM combined c
            JOIN product_categories pc ON pc.id = c.id
            LEFT JOIN product_categories parent ON parent.id = pc.parent_id
            LEFT JOIN product_categories gp     ON gp.id = parent.parent_id
            ORDER BY pc.level DESC, c.score DESC
            LIMIT 15`,
            [norm]
        );

        res.json({ success: true, results: results.rows });
    } catch (err) {
        console.error('product search error:', err.message);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

/* GET /api/users/me/notifications */
router.get('/me/notifications', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, type, title, body, data, is_read, created_at
             FROM notifications WHERE user_id = $1
             ORDER BY created_at DESC LIMIT 30`,
            [req.user.sub]
        );
        const unread = result.rows.filter(n => !n.is_read).length;
        res.json({ success: true, notifications: result.rows, unread_count: unread });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch notifications' });
    }
});

/* POST /api/users/me/notifications/read-all */
router.post('/me/notifications/read-all', authenticateToken, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1 AND is_read = false', [req.user.sub]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to mark notifications read' });
    }
});

module.exports = router;
