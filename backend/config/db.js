'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  // Keep max connections reasonable; adjust for production
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Enforce SSL in production
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

// Named query helper — always use parameterised queries, never string interpolation
const query = (text, params) => pool.query(text, params);

/**
 * Runs `fn` against a single checked-out client wrapped in BEGIN/COMMIT, so
 * every statement inside it is part of one real transaction. Do not use the
 * `query` export above for multi-statement transactions — pool.query() may
 * hand different statements to different connections, so a BEGIN on one
 * connection and a COMMIT on another silently isn't a transaction at all.
 *
 * @param {(client: import('pg').PoolClient) => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {}); // rollback failure shouldn't mask the real error
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
