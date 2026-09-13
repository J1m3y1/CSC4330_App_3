'use strict';

/**
 * Promotes an existing registered user to admin and marks them approved,
 * so there is a way into the admin panel that doesn't involve hand-editing
 * the database. Admins are never created through the public API — this is
 * a deliberately operator-only, command-line action.
 *
 * Usage: npm run bootstrap-admin -- you@example.com
 */

require('dotenv').config();
const { Pool } = require('pg');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run bootstrap-admin -- you@example.com');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT, 10),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
  });

  try {
    const { rows } = await pool.query(
      `UPDATE users
       SET role = 'admin', is_approved = TRUE
       WHERE email = $1
       RETURNING id, email, role, is_approved`,
      [email]
    );

    if (!rows.length) {
      console.error(`[bootstrap-admin] No user found with email ${email}. Register the account first, then run this again.`);
      process.exit(1);
    }

    console.log(`[bootstrap-admin] ${rows[0].email} is now an approved admin (id ${rows[0].id}).`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[bootstrap-admin] FAILED:', err.message);
  process.exit(1);
});
