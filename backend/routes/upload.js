const express = require('express');
const router = express.Router();
const multer = require('multer');
const pool = require('../db/pool');
const { parseERP } = require('../services/erp-parser');
const { geocodeAddress } = require('../services/geocode');
const { authenticateToken } = require('../middleware/auth');
const config = require('../config');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.upload.maxPdfMb * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv',
        ];
        if (allowed.includes(file.mimetype) || file.originalname.match(/\.(xlsx|xls|csv)$/i)) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel (.xlsx, .xls) or CSV files are accepted'));
        }
    }
});

/* POST /api/upload/erp — parse + store ERP quotation file */
router.post('/erp', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

        // Record the upload
        const uploadResult = await pool.query(
            `INSERT INTO erp_uploads (user_id, file_name, file_size_bytes, status)
             VALUES ($1, $2, $3, 'processing')
             RETURNING id`,
            [req.user.sub, req.file.originalname, req.file.size]
        );
        const uploadId = uploadResult.rows[0].id;

        // Parse async — respond immediately with upload ID
        res.status(202).json({ success: true, upload_id: uploadId, message: 'Processing started' });

        // Process in background
        setImmediate(async () => {
            try {
                const parsed = await parseERP(req.file.buffer, req.file.originalname);

                if (parsed.error) {
                    await pool.query(
                        "UPDATE erp_uploads SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1",
                        [uploadId, parsed.error]
                    );
                    return;
                }

                await pool.query(
                    "UPDATE erp_uploads SET status = 'geocoding', rows_total = $2, column_mapping = $3 WHERE id = $1",
                    [uploadId, parsed.customers_found ?? parsed.clients.length, JSON.stringify(parsed.column_mapping)]
                );

                let imported = 0, failedCount = 0;

                for (const client of parsed.clients) {
                    let lat = null, lon = null;

                    // Precise addresses only — a client without a street address is stored but not pinned.
                    if (client.address) {
                        const addressStr = [client.address, client.state, 'India'].filter(Boolean).join(', ');
                        const geo = await geocodeAddress(addressStr);
                        if (geo && geo.precision !== 'locality') { lat = geo.lat; lon = geo.lon; }
                    }
                    if (lat == null) failedCount++;

                    const clientResult = await pool.query(
                        `INSERT INTO salesman_clients
                            (owner_user_id, customer_name, address, state, phone, email,
                             latitude, longitude, geom, geocode_status,
                             last_order_date, last_product_raw, last_order_amount,
                             total_orders, total_amount, source_file)
                         VALUES ($1,$2,$3,$4,$5,$6,$7::float8,$8::float8,
                             CASE WHEN $7::float8 IS NOT NULL AND $8::float8 IS NOT NULL
                                  THEN ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography
                                  ELSE NULL END,
                             CASE WHEN $7::float8 IS NOT NULL THEN 'geocoded'::geocode_status ELSE 'failed'::geocode_status END,
                             $9,$10,$11,$12,$13,$14)
                         ON CONFLICT (owner_user_id, customer_name, address)
                         DO UPDATE SET
                             phone = COALESCE(EXCLUDED.phone, salesman_clients.phone),
                             email = COALESCE(EXCLUDED.email, salesman_clients.email),
                             latitude = COALESCE(EXCLUDED.latitude, salesman_clients.latitude),
                             longitude = COALESCE(EXCLUDED.longitude, salesman_clients.longitude),
                             geom = COALESCE(EXCLUDED.geom, salesman_clients.geom),
                             geocode_status = CASE WHEN EXCLUDED.geom IS NOT NULL OR salesman_clients.geom IS NOT NULL
                                                   THEN 'geocoded'::geocode_status ELSE 'failed'::geocode_status END,
                             last_order_date = GREATEST(salesman_clients.last_order_date, EXCLUDED.last_order_date),
                             last_product_raw = COALESCE(EXCLUDED.last_product_raw, salesman_clients.last_product_raw),
                             last_order_amount = COALESCE(EXCLUDED.last_order_amount, salesman_clients.last_order_amount),
                             total_orders = salesman_clients.total_orders + EXCLUDED.total_orders,
                             total_amount = salesman_clients.total_amount + EXCLUDED.total_amount,
                             updated_at = NOW()
                         RETURNING id`,
                        [req.user.sub,
                         client.customer_name, client.address || '', client.state || '',
                         client.phone || null, client.email || null,
                         lat, lon,
                         client.last_order_date || null, client.last_product_raw || null,
                         client.last_order_amount || null,
                         (client.orders || []).length, client.total_amount || 0,
                         req.file.originalname]
                    );
                    imported++;

                    const clientId = clientResult.rows[0].id;
                    for (const order of client.orders || []) {
                        await pool.query(
                            `INSERT INTO salesman_client_orders
                                (client_id, quotation_no, order_date, status,
                                 item_name_raw, canonical_name, category_id, quantity, amount, source_file)
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
                            [clientId,
                             order.quotation_no || null, order.order_date || null, order.status || null,
                             order.item_name_raw, order.canonical_name || order.item_name_raw,
                             order.category_id || null, order.quantity || null, order.amount || null,
                             req.file.originalname]
                        );
                    }
                }

                await pool.query(
                    `UPDATE erp_uploads SET status = 'done', rows_imported = $2, rows_failed = $3, completed_at = NOW()
                     WHERE id = $1`,
                    [uploadId, imported, failedCount]
                );
            } catch (bgErr) {
                console.error('ERP background processing error:', bgErr);
                await pool.query(
                    "UPDATE erp_uploads SET status = 'failed', error_message = $2, completed_at = NOW() WHERE id = $1",
                    [uploadId, bgErr.message]
                ).catch(() => {});
            }
        });
    } catch (err) {
        console.error('ERP upload error:', err);
        res.status(500).json({ success: false, error: err.message || 'Upload failed' });
    }
});

/* GET /api/upload/erp/:id/status */
router.get('/erp/:id/status', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, file_name, status, rows_total, rows_imported, rows_failed,
                    column_mapping, error_message, created_at, completed_at
             FROM erp_uploads WHERE id = $1 AND user_id = $2`,
            [req.params.id, req.user.sub]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'Upload not found' });
        res.json({ success: true, upload: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch upload status' });
    }
});

/* GET /api/upload/erp — list user's uploads */
router.get('/erp', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, file_name, status, rows_total, rows_imported, rows_failed, created_at, completed_at
             FROM erp_uploads WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
            [req.user.sub]
        );
        res.json({ success: true, uploads: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch uploads' });
    }
});

module.exports = router;
