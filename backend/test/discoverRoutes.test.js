'use strict';

// Exercise the real Express routes, authentication and controllers against a
// deterministic DB adapter. No external database or real accounts are touched.
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const users = new Map();
const searches = new Map();
const browseQueries = [];
let savedLimit = false;

async function query(sql, params) {
  if (sql.startsWith('SELECT id, email')) return { rows: users.has(params[0]) ? [users.get(params[0])] : [] };
  if (sql.startsWith('SELECT is_approved')) return { rows: [{ is_approved: true }] };
  if (sql.includes('FOR UPDATE')) return { rows: [users.get(params[0])] };
  if (sql.startsWith('SELECT lat, lon')) return { rows: [{ lat: null, lon: null }] };
  if (sql.startsWith('SELECT COUNT(*) FROM saved_searches')) return { rows: [{ count: savedLimit ? '20' : String([...searches.values()].filter(s => s.user_id === params[0]).length) }] };
  if (sql.startsWith('INSERT INTO saved_searches')) {
    const search = { id: randomUUID(), user_id: params[0], name: params[1], filters: JSON.parse(params[2]) };
    searches.set(search.id, search);
    return { rows: [search] };
  }
  if (sql.startsWith('SELECT id, name, filters FROM saved_searches')) return { rows: [...searches.values()].filter(s => s.user_id === params[0]) };
  if (sql.startsWith('DELETE FROM saved_searches')) {
    const search = searches.get(params[0]);
    if (!search || search.user_id !== params[1]) return { rows: [] };
    searches.delete(search.id);
    return { rows: [{ id: search.id }] };
  }
  browseQueries.push({ sql, params: [...params] });
  if (sql.startsWith('SELECT COUNT(*) FROM (')) return { rows: [{ count: '0' }] };
  return { rows: [] };
}
const dbPath = require.resolve('../config/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query, withTransaction: fn => fn({ query }) } };
process.env.JWT_SECRET = 'search-route-test-only-secret';
const app = express();
app.use(express.json(), cookieParser());
app.use('/api/discover', require('../routes/discover'));
let server, base;
test.before(async () => {
  server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  base = `http://127.0.0.1:${server.address().port}/api/discover`;
});
test.after(async () => { await new Promise(resolve => server.close(resolve)); });
function member(tier) {
  const id = randomUUID();
  users.set(id, { id, email: 'fixture@example.test', role: 'member', membership_tier: tier, is_active: true });
  return { id, cookie: `access_token=${jwt.sign({ sub: id }, process.env.JWT_SECRET)}` };
}
async function request(user, path = '', method = 'GET', body) {
  const res = await fetch(base + path, { method, headers: { ...(user ? { Cookie: user.cookie } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, data: await res.json() };
}

test('Routes enforce auth and detailed filter membership on both entry points', async () => {
  assert.equal((await request(null)).status, 401);
  const silver = member('silver');
  assert.equal((await request(silver, '?age_min=18&photos=true')).status, 200);
  assert.equal((await request(silver, '?kinks=Roleplay')).status, 403);
  assert.equal((await request(silver, '/search?q=Alex&kinks=Roleplay')).status, 403);
  assert.equal((await request(silver, '?q[a]=bad')).status, 422);
  assert.equal((await request(member('gold'), '?kinks=Roleplay&kink_match=all')).status, 200);
  assert.match(browseQueries.at(-1).sql, /pi.level = 'into'/);
  assert.equal((await request(member('gold'), '?distance_miles=50')).status, 422);
});

test('Only Black creates or accesses saved searches, with owner-scoped deletion', async () => {
  for (const tier of ['free', 'silver', 'gold']) {
    const user = member(tier);
    assert.equal((await request(user, '/saved')).status, 403);
    assert.equal((await request(user, '/saved', 'POST', { name: 'Blocked', filters: {} })).status, 403);
  }
  const owner = member('black'), other = member('black');
  const saved = await request(owner, '/saved', 'POST', { name: '  My connections  ', filters: { kinks: 'Roleplay', kink_match: 'all', page: 3, limit: 10 } });
  assert.equal(saved.status, 201);
  assert.equal(saved.data.search.name, 'My connections');
  assert.deepEqual(saved.data.search.filters, { kinks: 'Roleplay', kink_match: 'all' });
  assert.equal((await request(other, '/saved')).data.searches.length, 0);
  assert.equal((await request(other, '/saved/' + saved.data.search.id, 'DELETE')).status, 404);
  assert.equal((await request(owner, '/saved')).data.searches.length, 1);
  assert.equal((await request(owner, '/saved/' + saved.data.search.id, 'DELETE')).status, 200);
  assert.equal((await request(owner, '/saved')).data.searches.length, 0);
});

test('Saved searches validate contents, cap creation, and use current membership', async () => {
  const owner = member('black');
  assert.equal((await request(owner, '/saved', 'POST', { name: 'Invalid', filters: { age_min: 15 } })).status, 422);
  assert.equal((await request(owner, '/saved', 'POST', { name: '', filters: {} })).status, 422);
  assert.equal((await request(owner, '/saved/not-a-uuid', 'DELETE')).status, 422);
  savedLimit = true;
  assert.equal((await request(owner, '/saved', 'POST', { name: 'Over cap', filters: {} })).status, 422);
  savedLimit = false;
  users.get(owner.id).membership_tier = 'gold';
  assert.equal((await request(owner, '/saved', 'POST', { name: 'Downgraded', filters: {} })).status, 403);
  assert.equal((await request(owner, '?kinks=Custom%20term')).status, 403);
});
