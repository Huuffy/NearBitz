/**
 * Runs all SQL migrations in order against the configured PostgreSQL database.
 * Safe to re-run — all migrations use IF NOT EXISTS / ON CONFLICT DO NOTHING.
 *
 * Usage: node backend/scripts/run-migrations.js
 */
const fs   = require('fs');
const path = require('path');
const pool = require('../db/pool');

const BASE   = path.join(__dirname, '../db');
const MIGS   = path.join(BASE, 'migrations');

const FILES = [
    path.join(BASE, 'init.sql'),
    ...fs.readdirSync(MIGS)
        .filter(f => f.endsWith('.sql'))
        .sort()
        .map(f => path.join(MIGS, f)),
];

async function run() {
    const client = await pool.connect();
    try {
        // Create tracking table if it doesn't exist
        await client.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                filename TEXT PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT NOW()
            )
        `);

        for (const file of FILES) {
            const name = path.relative(BASE, file);
            // Check if already applied
            const check = await client.query(
                'SELECT 1 FROM schema_migrations WHERE filename = $1', [name]
            );
            if (check.rows.length) {
                console.log(`  skip ${name}`);
                continue;
            }
            const sql = fs.readFileSync(file, 'utf8');
            try {
                await client.query('BEGIN');
                await client.query(sql);
                await client.query(
                    'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [name]
                );
                await client.query('COMMIT');
                console.log(`  ok   ${name}`);
            } catch (err) {
                await client.query('ROLLBACK');
                console.error(`  FAIL ${name}: ${err.message}`);
                throw err;
            }
        }
        console.log('\nAll migrations complete.');
    } finally {
        client.release();
        await pool.end();
    }
}

run().catch(err => { console.error(err.message); process.exit(1); });
