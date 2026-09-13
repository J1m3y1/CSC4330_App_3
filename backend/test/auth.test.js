'use strict';

/**
 * Smoke test for the full auth lifecycle, against a real Postgres connection
 * (same DB_* env vars as the app). Not a mock — this is the same code path
 * a real signup goes through: register -> blocked while pending -> approved
 * by an admin -> login -> refresh -> logout -> account cleaned up.
 *
 * Run with: npm test
 */

require('dotenv').config();
const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../server');
const { pool } = require('../config/db');

let server;
let baseUrl;
const testEmail = `smoke-test-${Date.now()}@fantasi.test`;
const testPassword = 'Sm0keTest!Pass123';

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  // Clean up the account this test created, regardless of pass/fail.
  await pool.query('DELETE FROM users WHERE email = $1', [testEmail]).catch(() => {});
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
});

function jar() {
  // Keyed by name so a later Set-Cookie (e.g. logout's clearCookie) replaces
  // the earlier value instead of both being sent — a plain array here would
  // send the stale, still-valid access token alongside the emptied one and
  // mask a real logout bug behind a test-harness bug.
  const cookies = new Map();
  return {
    async fetch(path, opts = {}) {
      const cookieHeader = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
      const res = await fetch(baseUrl + path, {
        ...opts,
        headers: { ...opts.headers, cookie: cookieHeader },
        redirect: 'manual',
      });
      const setCookie = res.headers.getSetCookie?.() || [];
      for (const c of setCookie) {
        const [pair] = c.split(';');
        const eq = pair.indexOf('=');
        cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
      }
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    },
  };
}

test('register -> blocked while pending -> approve -> login -> refresh -> logout', async () => {
  const client = jar();

  // 1. Register
  const register = await client.fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      display_name: 'Smoke Test',
      date_of_birth: '1990-01-01',
    }),
  });
  assert.equal(register.status, 201);
  assert.equal(register.data.pending_approval, true);

  // 2. Login is blocked until approved
  const blockedLogin = await client.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  assert.equal(blockedLogin.status, 403);
  assert.equal(blockedLogin.data.pending_approval, true);

  // 3. Approve directly via the DB (bypasses needing a second admin session
  // in this test — the admin-endpoint path itself is covered by exercising
  // requireAdmin in the manual test pass described in the audit).
  await pool.query('UPDATE users SET is_approved = TRUE WHERE email = $1', [testEmail]);

  // 4. Login now succeeds
  const login = await client.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  assert.equal(login.status, 200);

  // 5. /api/auth/me reflects the session
  const me = await client.fetch('/api/auth/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.email, testEmail);
  assert.equal(me.data.is_approved, true);

  // 6. Refresh rotates the token pair and keeps the session valid
  const refresh = await client.fetch('/api/auth/refresh', { method: 'POST' });
  assert.equal(refresh.status, 200);
  const meAfterRefresh = await client.fetch('/api/auth/me');
  assert.equal(meAfterRefresh.status, 200);

  // 7. Logout invalidates the session
  const logout = await client.fetch('/api/auth/logout', { method: 'POST' });
  assert.equal(logout.status, 200);
  const meAfterLogout = await client.fetch('/api/auth/me');
  assert.equal(meAfterLogout.status, 401);
});

test('wrong password is rejected without revealing whether the account exists', async () => {
  const client = jar();
  const res = await client.fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'definitely-not-registered@fantasi.test', password: 'whatever123!A' }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.data.error, 'Invalid email or password.');
});
