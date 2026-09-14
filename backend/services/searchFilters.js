'use strict';

const { GENERIC_TAGS } = require('../config/interestTags');
const { ETHNICITIES, DRINKING, CHILDREN, LANGUAGES } = require('../config/profileOptions');

const BASIC = new Set(['q', 'location', 'age_min', 'age_max', 'photos', 'sort', 'page', 'limit']);
const NUMBERS = {
  age_min: [18, 100], age_max: [18, 100], distance_miles: [1, 500],
  height_min: [100, 250], height_max: [100, 250], weight_min: [50, 700], weight_max: [50, 700],
  page: [1, 100000], limit: [1, 50],
};
const BOOLEANS = ['photos', 'online', 'id_verified', 'viewed', 'unviewed', 'viewed_me', 'liked', 'liked_me'];
const LISTS = ['interests', 'looking_for', 'exclude_looking_for', 'kinks', 'languages'];
const TEXT = { q: 100, location: 100, education: 60, relationship_status: 60, smoking: 30, profile_text: 100 };
const ENUMS = { tier: ['free', 'silver', 'gold', 'black'], sort: ['active', 'newest'], kink_match: ['any', 'all'], ethnicity: ETHNICITIES, drinking: DRINKING, children: CHILDREN };
const ALLOWED = new Set([...BASIC, ...Object.keys(NUMBERS), ...BOOLEANS, ...LISTS, ...Object.keys(TEXT), ...Object.keys(ENUMS)]);

function invalid(message, status = 422) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

// One validator for live queries and saved combinations. Never trust a stored
// preset to retain permissions after a membership change.
function normalizeFilters(input, tier) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Filters must be an object.');
  const result = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!ALLOWED.has(key)) invalid(`Unknown filter: ${key}.`);
    if (!['string', 'number', 'boolean'].includes(typeof raw)) invalid(`Invalid ${key} filter.`);
    const value = String(raw).trim();
    if (!value) continue;
    if (BOOLEANS.includes(key)) {
      if (!['true', 'false', '1', '0'].includes(value)) invalid(`Invalid ${key} option.`);
      if (value === 'false' || value === '0') continue;
    }
    if (!BASIC.has(key) && !['gold', 'black'].includes(tier)) invalid('Detailed search filters require Gold or Black membership.', 403);
    if (NUMBERS[key]) {
      const [min, max] = NUMBERS[key];
      if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) invalid(`${key} must be a whole number from ${min} to ${max}.`);
      result[key] = Number(value);
    } else if (BOOLEANS.includes(key)) {
      result[key] = true;
    } else if (ENUMS[key]) {
      if (!ENUMS[key].includes(value)) invalid(`Invalid ${key} selection.`);
      result[key] = value;
    } else if (LISTS.includes(key)) {
      const values = [...new Set(value.split(',').map(s => s.trim()).filter(Boolean))];
      if (!values.length || values.length > 20 || values.some(v => v.length > 50)) invalid(`${key} allows up to 20 selections of 50 characters.`);
      if (key === 'languages' && values.some(v => !LANGUAGES.includes(v))) invalid('Invalid language selection.');
      if (['kinks', 'interests'].includes(key) && tier !== 'black' && values.some(v => !GENERIC_TAGS.includes(v))) invalid('Custom interest filters require Black membership.', 403);
      result[key] = values.join(',');
    } else {
      if (value.length > TEXT[key]) invalid(`${key} is too long.`);
      result[key] = value;
    }
  }
  for (const name of ['age', 'height', 'weight']) {
    if (result[`${name}_min`] !== undefined && result[`${name}_max`] !== undefined && result[`${name}_min`] > result[`${name}_max`]) invalid(`Minimum ${name} cannot exceed maximum ${name}.`);
  }
  if (result.viewed && result.unviewed) invalid('Choose viewed or unviewed, not both.');
  if (result.kink_match && !result.kinks) invalid('Select kinks before choosing how to match them.');
  return result;
}

const VISIBLE_PROFILE = `(NOT p.black_only_visibility OR $2 = 'black' OR EXISTS (SELECT 1 FROM profile_view_requests access WHERE access.owner_id = p.user_id AND access.requester_id = $1 AND access.status = 'approved'))`;
const PHOTO_ACCESS = `(NOT p.blur_photos OR EXISTS (SELECT 1 FROM photo_approvals pa WHERE pa.owner_id = p.user_id AND pa.viewer_id = $1 AND pa.status = 'approved'))`;
// Legacy profile setup stores measurement labels. Read the label's unit first,
// since early unit toggles could change without converting the label itself.
const HEIGHT_CM = String.raw`(CASE
  WHEN p.height_label ~ '^[0-9]+[[:space:]]*cm$' THEN substring(p.height_label FROM '^([0-9]+)')::numeric
  WHEN p.height_label ~ '^[0-9]+''[0-9]+"$' THEN substring(p.height_label FROM '^([0-9]+)')::numeric * 30.48 + substring(p.height_label FROM '''([0-9]+)')::numeric * 2.54
  ELSE NULL END)`;
const WEIGHT_FACTOR = `(CASE WHEN p.weight_label ~ 'kg$' THEN 2.2046226218 ELSE 1 END)`;
const WEIGHT_LOW = `(substring(p.weight_label FROM '^([0-9]+)')::numeric * ${WEIGHT_FACTOR})`;
const WEIGHT_HIGH = String.raw`(COALESCE(substring(p.weight_label FROM '^[0-9]+[[:space:]]*[-–][[:space:]]*([0-9]+)')::numeric, substring(p.weight_label FROM '^([0-9]+)')::numeric) * ${WEIGHT_FACTOR})`;

function buildFilterSql(f, params) {
  const clauses = [];
  const bind = value => { params.push(value); return `$${params.length}`; };
  const list = key => f[key].split(',');
  const literal = value => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
  const privateFields = ['interests', 'looking_for', 'exclude_looking_for', 'kinks', 'profile_text', 'education', 'relationship_status', 'smoking', 'ethnicity', 'drinking', 'children', 'languages', 'age_min', 'age_max', 'height_min', 'height_max', 'weight_min', 'weight_max', 'location', 'distance_miles', 'online'];
  if (privateFields.some(k => f[k] !== undefined)) clauses.push(VISIBLE_PROFILE);
  if (f.q && f.q.length >= 2) clauses.push(`p.display_name ILIKE ${bind(literal(f.q))}`);
  if (f.location) clauses.push(`p.show_location = TRUE AND p.location ILIKE ${bind(literal(f.location))}`);
  if (f.tier) clauses.push(`u.membership_tier = ${bind(f.tier)}`);
  for (const key of ['education', 'relationship_status', 'smoking', 'ethnicity', 'drinking', 'children']) {
    if (f[key]) clauses.push(`p.${key} = ${bind(f[key])}`);
  }
  for (const key of ['interests', 'looking_for', 'languages']) {
    if (f[key]) clauses.push(`p.${key} && ${bind(list(key))}::text[]`);
  }
  if (f.exclude_looking_for) clauses.push(`NOT (p.looking_for && ${bind(list('exclude_looking_for'))}::text[])`);
  if (f.profile_text) clauses.push(`(p.bio ILIKE ${bind(literal(f.profile_text))} OR p.heading ILIKE ${bind(literal(f.profile_text))})`);
  if (f.kinks) {
    const tags = list('kinks');
    const ref = bind(tags);
    clauses.push(f.kink_match === 'all'
      ? `(SELECT COUNT(DISTINCT pi.tag) FROM profile_interests pi WHERE pi.user_id = p.user_id AND pi.level = 'into' AND pi.tag = ANY(${ref}::text[])) = ${bind(tags.length)}`
      : `EXISTS (SELECT 1 FROM profile_interests pi WHERE pi.user_id = p.user_id AND pi.level = 'into' AND pi.tag = ANY(${ref}::text[]))`);
  }
  for (const [prefix, expression] of [['age', "DATE_PART('year', AGE(p.date_of_birth))"], ['height', HEIGHT_CM]]) {
    if (f[`${prefix}_min`] !== undefined) clauses.push(`${expression} >= ${bind(f[`${prefix}_min`])}`);
    if (f[`${prefix}_max`] !== undefined) clauses.push(`${expression} <= ${bind(f[`${prefix}_max`])}`);
  }
  if (f.weight_min !== undefined || f.weight_max !== undefined) {
    clauses.push(`p.weight_visible = TRUE AND p.weight_label ~ '^[0-9]+([[:space:]]*[-–][[:space:]]*[0-9]+)?[[:space:]]*(lbs|kg)$'`);
    if (f.weight_min !== undefined) clauses.push(`${WEIGHT_HIGH} >= ${bind(f.weight_min)}`);
    if (f.weight_max !== undefined) clauses.push(`${WEIGHT_LOW} <= ${bind(f.weight_max)}`);
  }
  if (f.distance_miles) clauses.push(`p.show_location = TRUE AND p.lat IS NOT NULL AND p.lon IS NOT NULL AND EXISTS (
    SELECT 1 FROM profiles origin WHERE origin.user_id = $1 AND origin.lat IS NOT NULL AND origin.lon IS NOT NULL
    AND 3959 * acos(LEAST(1, GREATEST(-1, cos(radians(origin.lat)) * cos(radians(p.lat)) * cos(radians(p.lon) - radians(origin.lon)) + sin(radians(origin.lat)) * sin(radians(p.lat))))) <= ${bind(f.distance_miles)})`);
  if (f.online) clauses.push(`p.show_last_active = TRUE AND p.last_active_at >= NOW() - INTERVAL '5 minutes'`);
  if (f.photos) clauses.push(`${PHOTO_ACCESS} AND (NULLIF(p.avatar_url, '') IS NOT NULL OR EXISTS (SELECT 1 FROM profile_photos pp WHERE pp.user_id = p.user_id))`);
  if (f.id_verified) clauses.push(`EXISTS (SELECT 1 FROM identity_documents doc WHERE doc.user_id = p.user_id AND doc.status = 'approved')`);
  if (f.viewed || f.unviewed) clauses.push(`${f.unviewed ? 'NOT ' : ''}EXISTS (SELECT 1 FROM profile_views pv WHERE pv.viewer_id = $1 AND pv.viewed_id = p.user_id)`);
  if (f.viewed_me) clauses.push(`EXISTS (SELECT 1 FROM profile_views pv WHERE pv.viewer_id = p.user_id AND pv.viewed_id = $1)`);
  if (f.liked) clauses.push(`EXISTS (SELECT 1 FROM profile_likes pl WHERE pl.liker_id = $1 AND pl.liked_id = p.user_id)`);
  if (f.liked_me) clauses.push(`EXISTS (SELECT 1 FROM profile_likes pl WHERE pl.liker_id = p.user_id AND pl.liked_id = $1)`);
  return clauses;
}

module.exports = { normalizeFilters, buildFilterSql, VISIBLE_PROFILE };
