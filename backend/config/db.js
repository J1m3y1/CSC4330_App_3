'use strict';

const { Pool } = require('pg');

// Whether this connection needs TLS at all. Deciding this from NODE_ENV
// alone is fragile — a host that fails to set NODE_ENV=production (as
// happened on first Azure deploy: server.js logged "Environment: undefined")
// silently falls through to ssl:false, and a managed Postgres that requires
// TLS then just hangs until connectionTimeoutMillis, which looks exactly
// like "can't connect to the DB" with no hint that SSL was the reason.
// Inferring from the host is more robust: nothing that isn't literally
// local ever plausibly wants an unencrypted DB connection.
const isLocalDb = ['localhost', '127.0.0.1'].includes(process.env.DB_HOST);
const needsSsl = process.env.NODE_ENV === 'production' || !isLocalDb;

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
  // Managed Postgres (Azure Database for PostgreSQL, RDS, etc.) terminates
  // TLS with a CA that isn't in Node's default trust store unless you bundle
  // it yourself — rejectUnauthorized: true with no `ca` set fails the
  // handshake outright. Still encrypts the connection either way; this just
  // skips strict chain validation unless DB_SSL_REJECT_UNAUTHORIZED=true is
  // explicitly set once the provider's CA cert is actually configured.
  ssl: needsSsl ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' } : false,
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
