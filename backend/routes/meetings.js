const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticateToken, requireRole } = require('../middleware/auth');

// GET /api/meetings — list meetings for current user
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    const status = req.query.status;

    let query, params;

    if (role === 'salesman') {
      query = `
        SELECT m.*, c.name AS company_name, c.logo_url, c.city
        FROM meetings m
        LEFT JOIN companies c ON c.id = m.host_company_id
        WHERE m.requested_by_user_id = $1
        ${status ? 'AND m.status = $2' : ''}
        ORDER BY m.proposed_at DESC
        LIMIT 50
      `;
      params = status ? [userId, status] : [userId];
    } else {
      // company_member or company_admin: show meetings for their company
      query = `
        SELECT m.*, u.full_name AS requester_name, u.email AS requester_email
        FROM meetings m
        LEFT JOIN users u ON u.id = m.requested_by_user_id
        WHERE m.host_company_id = $1
        ${status ? 'AND m.status = $2' : ''}
        ORDER BY m.proposed_at DESC
        LIMIT 50
      `;
      params = status ? [req.user.company_id, status] : [req.user.company_id];
    }

    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// POST /api/meetings — salesman requests a meeting
router.post('/', authenticateToken, requireRole('salesman', 'platform_admin'), async (req, res, next) => {
  try {
    const { host_company_id, title, proposed_at, duration_minutes, notes, location_address, location_lat, location_lon } = req.body;

    if (!host_company_id || !title || !proposed_at) {
      return res.status(400).json({ success: false, error: 'host_company_id, title, and proposed_at are required' });
    }

    const { rows } = await pool.query(`
      INSERT INTO meetings (
        id, title, meeting_type, status,
        requested_by_user_id, host_company_id,
        proposed_at, duration_minutes,
        notes, location_address, location_lat, location_lon,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, 'ad_hoc', 'requested',
        $2, $3, $4, $5, $6, $7, $8, $9,
        NOW(), NOW()
      )
      RETURNING *
    `, [title, req.user.id, host_company_id, proposed_at, duration_minutes || 30, notes, location_address, location_lat, location_lon]);

    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/meetings/:id/status — accept / decline / complete / cancel
router.patch('/:id/status', authenticateToken, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, outcome, outcome_tags } = req.body;

    const allowed = ['accepted', 'declined', 'completed', 'cancelled', 'no_show'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, error: `status must be one of: ${allowed.join(', ')}` });
    }

    // Permission check: company can accept/decline/complete; salesman can cancel
    const { rows: existing } = await pool.query('SELECT * FROM meetings WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Meeting not found' });

    const meeting = existing[0];
    const user = req.user;

    const isCompanyUser = user.company_id && user.company_id === meeting.host_company_id;
    const isRequester = user.id === meeting.requested_by_user_id;

    if (!isCompanyUser && !isRequester && user.role !== 'platform_admin') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    if (['accepted', 'declined'].includes(status) && !isCompanyUser && user.role !== 'platform_admin') {
      return res.status(403).json({ success: false, error: 'Only the host company can accept or decline' });
    }

    if (status === 'cancelled' && !isRequester && user.role !== 'platform_admin') {
      return res.status(403).json({ success: false, error: 'Only the requester can cancel' });
    }

    const { rows } = await pool.query(`
      UPDATE meetings SET
        status = $1,
        outcome = COALESCE($2, outcome),
        outcome_tags = COALESCE($3, outcome_tags),
        confirmed_at = CASE WHEN $1 = 'accepted' THEN NOW() ELSE confirmed_at END,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *
    `, [status, outcome || null, outcome_tags || null, id]);

    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// GET /api/meetings/:id — get single meeting
router.get('/:id', authenticateToken, async (req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT m.*,
        c.name AS company_name, c.logo_url, c.city AS company_city,
        u.full_name AS requester_name, u.email AS requester_email, u.phone AS requester_phone
      FROM meetings m
      LEFT JOIN companies c ON c.id = m.host_company_id
      LEFT JOIN users u ON u.id = m.requested_by_user_id
      WHERE m.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ success: false, error: 'Meeting not found' });

    const meeting = rows[0];
    const user = req.user;
    const isCompanyUser = user.company_id && user.company_id === meeting.host_company_id;
    const isRequester = user.id === meeting.requested_by_user_id;

    if (!isCompanyUser && !isRequester && user.role !== 'platform_admin') {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    res.json({ success: true, data: meeting });
  } catch (err) { next(err); }
});

module.exports = router;
