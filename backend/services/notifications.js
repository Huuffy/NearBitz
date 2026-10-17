/**
 * Create in-app notification rows.
 * Called by meetings, feed, and follow handlers — never awaited in the hot path.
 */

const pool = require('../db/pool');

/**
 * @param {string} userId  - Recipient user UUID
 * @param {string} type    - notification_type ENUM value
 * @param {string} title   - Short notification title
 * @param {string} body    - Longer description
 * @param {object} data    - { entity_type, entity_id } for deep-linking
 */
async function createNotification(userId, type, title, body = null, data = null) {
    try {
        await pool.query(
            `INSERT INTO notifications (user_id, type, title, body, data)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, type, title, body, data ? JSON.stringify(data) : null]
        );
    } catch (err) {
        // Non-fatal — log and continue
        console.error('[notifications] Failed to create notification:', err.message);
    }
}

module.exports = { createNotification };
