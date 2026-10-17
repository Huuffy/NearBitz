const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const pool = require('../db/pool');
const config = require('../config');
const { authenticateToken } = require('../middleware/auth');

const COOKIE_OPTS = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth'
};

function makeAccessToken(user) {
    return jwt.sign(
        { sub: user.id, email: user.email, role: user.role, company_id: user.company_id, full_name: user.full_name },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
    );
}

/* POST /api/auth/register */
router.post('/register', async (req, res) => {
    try {
        const { email, password, full_name, role = 'salesman', phone } = req.body;
        if (!email || !password || !full_name) {
            return res.status(400).json({ success: false, error: 'email, password, and full_name are required' });
        }
        if (password.length < 8) {
            return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
        }
        const allowedRoles = ['salesman', 'company_admin', 'company_member'];
        if (!allowedRoles.includes(role)) {
            return res.status(400).json({ success: false, error: 'Invalid role' });
        }

        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existing.rows.length) {
            return res.status(409).json({ success: false, error: 'Email already registered' });
        }

        const hash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            `INSERT INTO users (email, password_hash, full_name, role, phone, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
             RETURNING id, email, full_name, role, company_id, phone`,
            [email.toLowerCase(), hash, full_name, role, phone || null]
        );
        const user = result.rows[0];
        const token = makeAccessToken(user);
        res.status(201).json({ success: true, access_token: token, user });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ success: false, error: 'Registration failed' });
    }
});

/* POST /api/auth/login */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password required' });
        }

        const result = await pool.query(
            'SELECT id, email, password_hash, full_name, role, company_id, phone, is_active FROM users WHERE email = $1',
            [email.toLowerCase()]
        );
        if (!result.rows.length) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }
        const user = result.rows[0];
        if (!user.is_active) {
            return res.status(403).json({ success: false, error: 'Account is inactive' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ success: false, error: 'Invalid credentials' });
        }

        // Create refresh token — store SHA-256 hash in DB
        const rawToken = crypto.randomBytes(32).toString('hex');
        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        // Clean up old tokens for this user (keep only last 5)
        await pool.query(
            `DELETE FROM refresh_tokens WHERE user_id = $1 AND id NOT IN (
                SELECT id FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 4
             )`,
            [user.id]
        );

        await pool.query(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
            [user.id, tokenHash, expiresAt]
        );

        res.cookie('refresh_token', rawToken, COOKIE_OPTS);
        const accessToken = makeAccessToken(user);
        res.json({
            success: true,
            access_token: accessToken,
            user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, company_id: user.company_id }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

/* POST /api/auth/refresh */
router.post('/refresh', async (req, res) => {
    try {
        const rawToken = req.cookies && req.cookies.refresh_token;
        if (!rawToken) {
            return res.status(401).json({ success: false, error: 'No refresh token' });
        }

        const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
        const result = await pool.query(
            `SELECT rt.id, rt.user_id, rt.expires_at,
                    u.email, u.full_name, u.role, u.company_id, u.is_active
             FROM refresh_tokens rt
             JOIN users u ON u.id = rt.user_id
             WHERE rt.token_hash = $1`,
            [tokenHash]
        );

        if (!result.rows.length) {
            return res.status(401).json({ success: false, error: 'Invalid refresh token' });
        }

        const row = result.rows[0];
        if (new Date(row.expires_at) < new Date()) {
            await pool.query('DELETE FROM refresh_tokens WHERE id = $1', [row.id]);
            res.clearCookie('refresh_token', { path: '/api/auth' });
            return res.status(401).json({ success: false, error: 'Refresh token expired' });
        }
        if (!row.is_active) {
            return res.status(403).json({ success: false, error: 'Account inactive' });
        }

        const accessToken = makeAccessToken({
            id: row.user_id, email: row.email, full_name: row.full_name,
            role: row.role, company_id: row.company_id
        });
        res.json({ success: true, access_token: accessToken });
    } catch (err) {
        console.error('Refresh error:', err);
        res.status(500).json({ success: false, error: 'Token refresh failed' });
    }
});

/* POST /api/auth/logout */
router.post('/logout', async (req, res) => {
    try {
        const rawToken = req.cookies && req.cookies.refresh_token;
        if (rawToken) {
            const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [tokenHash]);
        }
        res.clearCookie('refresh_token', { path: '/api/auth' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Logout failed' });
    }
});

/* GET /api/auth/me */
router.get('/me', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, email, full_name, role, company_id, phone, avatar_url, is_active, created_at FROM users WHERE id = $1',
            [req.user.sub]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, error: 'User not found' });
        res.json({ success: true, user: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to fetch user' });
    }
});

module.exports = router;
