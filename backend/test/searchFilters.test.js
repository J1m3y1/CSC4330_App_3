'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFilters, buildFilterSql } = require('../services/searchFilters');

test('Silver can use basic search but cannot submit any detailed filter', () => {
  assert.deepEqual(normalizeFilters({ q: 'Alex', location: 'Texas', age_min: '18', age_max: '60', photos: 'true' }, 'silver'), { q: 'Alex', location: 'Texas', age_min: 18, age_max: 60, photos: true });
  for (const tier of ['free', 'silver', undefined]) {
    for (const query of [{ kinks: 'Rope & bondage' }, { education: 'College' }, { tier: 'black' }, { distance_miles: 10 }, { online: true }, { profile_text: 'travel' }]) {
      assert.throws(() => normalizeFilters(query, tier), { status: 403 });
    }
  }
});

test('Gold selects catalog kinks; Black may supply custom kink terms', () => {
  assert.equal(normalizeFilters({ kinks: 'Rope & bondage,Rope & bondage', kink_match: 'all' }, 'gold').kinks, 'Rope & bondage');
  assert.throws(() => normalizeFilters({ kinks: 'My custom preference' }, 'gold'), { status: 403 });
  assert.equal(normalizeFilters({ kinks: 'My custom preference' }, 'black').kinks, 'My custom preference');
});

test('Malformed, conflicting and out of bounds filters are rejected', () => {
  for (const query of [{ age_min: 17 }, { age_min: 40, age_max: 30 }, { height_min: 200, height_max: 160 }, { weight_min: 200, weight_max: 100 }, { distance_miles: '10miles' }, { viewed: true, unviewed: true }, { languages: 'Not a language' }, { online: 'yes' }, { q: ['a', 'b'] }, { sql: '1=1' }, { kink_match: 'all' }, { page: Infinity }]) {
    assert.throws(() => normalizeFilters(query, 'black'), { status: 422 });
  }
});

test('Kink matching uses only positive structured interests, supports any/all, binds values', () => {
  for (const match of ['any', 'all']) {
    const params = ['viewer', 'gold'];
    const sql = buildFilterSql({ kinks: 'Rope & bondage,Impact play', kink_match: match }, params).join(' AND ');
    assert.match(sql, /pi.level = 'into'/);
    assert.match(sql, /profile_view_requests/);
    assert.doesNotMatch(sql, /p.interests/);
    assert.doesNotMatch(sql, /Rope & bondage/);
    assert.deepEqual(params[2], ['Rope & bondage', 'Impact play']);
    if (match === 'all') { assert.match(sql, /COUNT\(DISTINCT pi.tag\)/); assert.equal(params[3], 2); }
    else assert.match(sql, /EXISTS \(SELECT 1 FROM profile_interests/);
  }
});

test('Detailed matches respect restricted profiles and attribute visibility', () => {
  const params = ['viewer', 'gold'];
  const sql = buildFilterSql({ location: 'Texas', distance_miles: 25, weight_min: 150, online: true, photos: true }, params).join(' AND ');
  assert.match(sql, /NOT p.black_only_visibility/);
  assert.match(sql, /p.weight_visible = TRUE/);
  assert.match(sql, /p.show_location = TRUE/);
  assert.match(sql, /p.show_last_active = TRUE/);
  assert.match(sql, /pa.status = 'approved'/);
  assert.match(sql, /origin.user_id = \$1/);
});

test('SQL injection and wildcard text are handled as literal bound values', () => {
  const params = ['viewer', 'black'];
  const sql = buildFilterSql({ profile_text: "%' OR 1=1 --", kinks: "custom' OR true --", height_min: 180 }, params).join(' AND ');
  assert.doesNotMatch(sql, /OR 1=1|custom'/);
  assert.equal(params[2], "%\\%' OR 1=1 --%");
  const placeholders = [...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1]));
  assert.equal(Math.max(...placeholders), params.length);
});

test('Interaction directions, exclusion and unknown measurement handling are explicit', () => {
  const sql = buildFilterSql({ liked: true, liked_me: true, viewed_me: true, unviewed: true, exclude_looking_for: 'Casual', height_min: 150, weight_max: 200 }, ['viewer', 'black']).join(' AND ');
  assert.match(sql, /pl.liker_id = \$1 AND pl.liked_id = p.user_id/);
  assert.match(sql, /pl.liker_id = p.user_id AND pl.liked_id = \$1/);
  assert.match(sql, /pv.viewer_id = p.user_id AND pv.viewed_id = \$1/);
  assert.match(sql, /NOT EXISTS \(SELECT 1 FROM profile_views/);
  assert.match(sql, /NOT \(p.looking_for &&/);
  assert.match(sql, /ELSE NULL END/);
});
