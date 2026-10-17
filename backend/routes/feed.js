const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

// GET /api/feed — personalised, cursor-paginated
router.get('/', authenticateToken, async (req, res, next) => {
  try {
    const userId = req.user.id;
    const cursor = req.query.cursor || new Date().toISOString();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const { rows } = await pool.query(`
      SELECT
        p.id, p.company_id, p.post_type, p.title, p.content,
        p.like_count, p.comment_count, p.view_count, p.published_at,
        c.name AS company_name, c.logo_url, c.slug AS company_slug,
        c.is_verified,
        ARRAY(
          SELECT url FROM post_media
          WHERE post_id = p.id
          ORDER BY display_order ASC
          LIMIT 3
        ) AS media_urls,
        EXISTS(
          SELECT 1 FROM post_likes pl
          WHERE pl.post_id = p.id AND pl.user_id = $1
        ) AS liked_by_me
      FROM posts p
      JOIN follows f ON f.following_company_id = p.company_id
      JOIN companies c ON c.id = p.company_id
      WHERE f.follower_user_id = $1
        AND p.is_published = true
        AND p.published_at < $2
      ORDER BY p.published_at DESC
      LIMIT $3
    `, [userId, cursor, limit]);

    const nextCursor = rows.length === limit
      ? rows[rows.length - 1].published_at
      : null;

    res.json({ success: true, data: rows, nextCursor });
  } catch (err) { next(err); }
});

// GET /api/feed/discover — public feed, no auth needed
router.get('/discover', optionalAuth, async (req, res, next) => {
  try {
    const cursor = req.query.cursor || new Date().toISOString();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    const { rows } = await pool.query(`
      SELECT
        p.id, p.company_id, p.post_type, p.title, p.content,
        p.like_count, p.comment_count, p.view_count, p.published_at,
        c.name AS company_name, c.logo_url, c.slug AS company_slug,
        c.is_verified, c.city,
        ARRAY(
          SELECT url FROM post_media
          WHERE post_id = p.id
          ORDER BY display_order ASC
          LIMIT 3
        ) AS media_urls
      FROM posts p
      JOIN companies c ON c.id = p.company_id
      WHERE p.is_published = true
        AND p.published_at < $1
        AND c.is_active = true
      ORDER BY p.published_at DESC
      LIMIT $2
    `, [cursor, limit]);

    const nextCursor = rows.length === limit
      ? rows[rows.length - 1].published_at
      : null;

    res.json({ success: true, data: rows, nextCursor });
  } catch (err) { next(err); }
});

module.exports = router;
