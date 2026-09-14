'use strict';

const { query } = require('../config/db');
const { normalizeFilters, buildFilterSql } = require('../services/searchFilters');

// Black-only visibility: a Silver/Gold viewer stays on the locked-card
// treatment until their view request is specifically approved — reused in
// every masked field below so an approval unlocks the card here too, not
// just the full getProfile fetch.
const NOT_APPROVED_FOR_VIEW = `NOT EXISTS (
          SELECT 1 FROM profile_view_requests pvr
          WHERE pvr.owner_id = p.user_id AND pvr.requester_id = $1 AND pvr.status = 'approved'
        )`;

// ── GET /api/discover ─────────────────────────────────────────────────────────
// Browse approved active members with optional filters.
// Excludes blocked users in both directions.
// Respects each member's privacy settings in the SQL projection.
async function discoverMembers(req, res) {
  try {
    const selected = normalizeFilters(req.query, req.user.membership_tier);
    const { sort = 'active', page: pageNum = 1, limit: limitNum = 20 } = selected;
    const offset = (pageNum - 1) * limitNum;
    const params = [req.user.id, req.user.membership_tier];
    if (selected.distance_miles) {
      const origin = await query('SELECT lat, lon FROM profiles WHERE user_id = $1', [req.user.id]);
      if (origin.rows[0]?.lat == null || origin.rows[0]?.lon == null) {
        return res.status(422).json({ error: 'Save your location in your profile before searching by distance.' });
      }
    }

    // Exclude self, inactive, unapproved accounts
    let sql = `
      SELECT
        p.user_id,
        p.display_name,
        -- Black-only visibility: a Silver/Gold viewer gets a locked card
        -- (name + avatar only, same as getProfile's restricted view) instead
        -- of being excluded outright, unless their view request has been
        -- approved — Free viewers still never see this row at all (see the
        -- WHERE clause below).
        CASE WHEN p.black_only_visibility AND $2 <> 'black' AND ${NOT_APPROVED_FOR_VIEW} THEN TRUE ELSE FALSE END AS restricted,
        CASE WHEN p.black_only_visibility AND $2 <> 'black' AND ${NOT_APPROVED_FOR_VIEW} THEN NULL ELSE p.bio END AS bio,
        -- Blurred-photo mode: withhold the real URL from anyone not
        -- individually approved, same rule as getProfile.
        CASE WHEN NOT p.blur_photos OR EXISTS(
          SELECT 1 FROM photo_approvals WHERE owner_id = p.user_id AND viewer_id = $1 AND status = 'approved'
        ) THEN p.avatar_url ELSE NULL END AS avatar_url,
        p.blur_photos AND NOT EXISTS(
          SELECT 1 FROM photo_approvals WHERE owner_id = p.user_id AND viewer_id = $1 AND status = 'approved'
        ) AS photos_hidden,
        CASE WHEN p.black_only_visibility AND $2 <> 'black' AND ${NOT_APPROVED_FOR_VIEW} THEN ARRAY[]::TEXT[] ELSE p.interests END AS interests,
        CASE WHEN p.black_only_visibility AND $2 <> 'black' AND ${NOT_APPROVED_FOR_VIEW} THEN ARRAY[]::TEXT[] ELSE p.looking_for END AS looking_for,
        CASE WHEN p.black_only_visibility AND $2 <> 'black' AND ${NOT_APPROVED_FOR_VIEW} THEN NULL ELSE p.heading END AS heading,
        p.is_complete,
        CASE WHEN p.black_only_visibility AND $2 <> 'black' AND ${NOT_APPROVED_FOR_VIEW} THEN NULL
             WHEN p.show_location THEN p.location ELSE NULL END AS location,
        CASE WHEN p.black_only_visibility AND $2 <> 'black' AND ${NOT_APPROVED_FOR_VIEW} THEN NULL
             WHEN p.show_last_active THEN p.last_active_at ELSE NULL END AS last_active_at,
        u.membership_tier,
        u.created_at AS member_since,
        EXISTS(SELECT 1 FROM profile_likes WHERE liker_id = $1 AND liked_id = p.user_id) AS liked_by_me,
        (SELECT status FROM profile_view_requests WHERE owner_id = p.user_id AND requester_id = $1) AS view_request_status,
        (p.boosted_until IS NOT NULL AND p.boosted_until > NOW()) AS boosted
      FROM profiles p
      JOIN users u ON u.id = p.user_id
      WHERE u.id <> $1
        AND u.is_active   = TRUE
        AND u.is_approved = TRUE
        AND p.is_complete = TRUE
        -- Exclude anyone who has blocked the viewer or been blocked by the viewer
        AND NOT EXISTS (
          SELECT 1 FROM blocks b
          WHERE (b.blocker_id = $1 AND b.blocked_id = u.id)
             OR (b.blocker_id = u.id AND b.blocked_id = $1)
        )
        -- Geofenced privacy (Black tier): exclude this member if the viewer's
        -- own geocoded location falls within one of their hidden zones. Fails
        -- open — a viewer with no geocoded location on file is never excluded.
        AND NOT EXISTS (
          SELECT 1 FROM profile_geofences g, profiles vp
          WHERE g.user_id = p.user_id
            AND vp.user_id = $1
            AND vp.lat IS NOT NULL AND vp.lon IS NOT NULL
            AND 3959 * acos(LEAST(1, GREATEST(-1,
                  cos(radians(vp.lat)) * cos(radians(g.lat)) * cos(radians(g.lon) - radians(vp.lon))
                  + sin(radians(vp.lat)) * sin(radians(g.lat))
                ))) <= g.radius_miles
        )
        -- Black-only visibility (Black tier, opt-in): a Free viewer never
        -- sees the row at all; Silver/Gold see the locked card built above.
        AND (NOT p.black_only_visibility OR $2 <> 'free')
    `;

    const filters = buildFilterSql(selected, params);
    let idx = params.length + 1;

    if (filters.length) {
      sql += ' AND ' + filters.join(' AND ');
    }

    // Count total for pagination
    const countSql = `SELECT COUNT(*) FROM (${sql}) AS sub`;
    const countRes = await query(countSql, params);
    const total    = parseInt(countRes.rows[0].count, 10);

    // Add ordering + pagination — an active boost always wins placement
    // first, whatever secondary sort was requested, matching the "temporary
    // priority placement in Discover" promise (see Boost in routes/profile.js).
    const orderBy = sort === 'newest'
      ? 'u.created_at DESC'
      : 'p.last_active_at DESC NULLS LAST, p.created_at DESC';
    sql += ` ORDER BY (p.boosted_until IS NOT NULL AND p.boosted_until > NOW()) DESC, ${orderBy}
             LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limitNum, offset);

    const { rows } = await query(sql, params);

    res.json({
      members: rows,
      pagination: {
        page:   pageNum,
        limit:  limitNum,
        total,
        pages:  Math.ceil(total / limitNum),
      },
    });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, ...(err.status === 403 ? { upgrade_required: true } : {}) });
    console.error('[discoverMembers]', err.message);
    res.status(500).json({ error: 'Could not fetch members.' });
  }
}

// ── GET /api/discover/search ──────────────────────────────────────────────────
// Name search with the same optional filters and permissions as browsing.
async function searchMembers(req, res) {
  if (typeof req.query.q !== 'string' || req.query.q.trim().length < 2) {
    return res.status(422).json({ error: 'Search query must be at least 2 characters.' });
  }
  return discoverMembers(req, res);
}

module.exports = { discoverMembers, searchMembers };
