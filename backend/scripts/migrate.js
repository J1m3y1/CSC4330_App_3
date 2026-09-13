'use strict';

/**
 * Tiny migration runner — applies every .sql file in db/migrations/ that
 * hasn't run yet, in filename order, and records each one in
 * schema_migrations so re-running this script is always safe.
 *
 * Usage: npm run migrate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

async function main() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  });

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows } = await pool.query('SELECT filename FROM schema_migrations');
    const applied = new Set(rows.map(r => r.filename));

    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let ranAny = false;
    for (const file of files) {
      if (applied.has(file)) continue;
      ranAny = true;
      console.log(`[migrate] applying ${file} ...`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      console.log(`[migrate] ${file} OK`);
    }

    if (!ranAny) console.log('[migrate] nothing to do — already up to date.');
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[migrate] FAILED:', err.message);
  process.exit(1);
});
