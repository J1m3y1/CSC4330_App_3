'use strict';

const path   = require('path');
const fs     = require('fs');
const { query, withTransaction } = require('../config/db');
const { GENERIC_TAG_GROUPS, GENERIC_TAGS, INTEREST_LEVELS } = require('../config/interestTags');
const { geocode } = require('../utils/geocode');
const { VIDEO_UPLOAD_DIR } = require('../middleware/upload');

// Same tier ranking used in middleware/auth.js, membershipController.js, and
// chatroomsController.js — duplicated rather than imported since none of
// those modules currently export it as a shared constant.
const TIER_RANK = { free: 0, silver: 1, gold: 2, black: 3 };
const CUSTOM_TAG_MIN_TIER = 'gold';

function deletePrivateVideo(storageKey) {
  if (!storageKey) return;
  fs.unlink(path.join(VIDEO_UPLOAD_DIR, path.basename(storageKey)), () => {});
}

// Gold and Black members may publish one short self-recorded introduction.
// An upload alone cannot substantiate a biometric liveness claim, so the UI
// accurately calls this a private introduction video rather than "verified".
async function uploadIntroVideo(req, res) {
  if (!req.file) return res.status(422).json({ error: 'Choose a video to upload.' });
  try {
    const existing = await query('SELECT storage_key FROM member_intro_videos WHERE user_id = $1', [req.user.id]);
    await query(
      `INSERT INTO member_intro_videos (user_id, storage_key, original_filename, mime_type)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET storage_key = EXCLUDED.storage_key,
         original_filename = EXCLUDED.original_filename, mime_type = EXCLUDED.mime_type, updated_at = NOW()`,
      [req.user.id, req.file.filename, req.file.originalname, req.file.mimetype]
    );
    if (existing.rows[0]?.storage_key) deletePrivateVideo(existing.rows[0].storage_key);
    res.status(201).json({ has_intro_video: true, message: 'Your private introduction video is ready.' });
  } catch (err) {
    deletePrivateVideo(req.file.filename);
    console.error('[uploadIntroVideo]', err.message);
    res.status(500).json({ error: 'Could not save the video.' });
  }
}

async function deleteIntroVideo(req, res) {
  try {
    const { rows } = await query('DELETE FROM member_intro_videos WHERE user_id = $1 RETURNING storage_key', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'No introduction video found.' });
    deletePrivateVideo(rows[0].storage_key);
    res.json({ has_intro_video: false, message: 'Introduction video removed.' });
  } catch (err) {
    console.error('[deleteIntroVideo]', err.message);
    res.status(500).json({ error: 'Could not remove the video.' });
  }
}

async function streamIntroVideo(req, res) {
  try {
    const { rows } = await query(
      `SELECT v.storage_key, v.mime_type FROM member_intro_videos v
       JOIN users u ON u.id = v.user_id
       WHERE v.user_id = $1 AND u.is_active = TRUE AND u.is_approved = TRUE
         AND NOT EXISTS (SELECT 1 FROM blocks b
           WHERE (b.blocker_id = $2 AND b.blocked_id = v.user_id)
              OR (b.blocker_id = v.user_id AND b.blocked_id = $2))`,
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Introduction video not found.' });
    const video = rows[0];
    const filePath = path.join(VIDEO_UPLOAD_DIR, path.basename(video.storage_key));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Introduction video not found.' });
    const size = fs.statSync(filePath).size;
    const range = req.headers.range;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', video.mime_type);
    if (!range) { res.setHeader('Content-Length', size); return fs.createReadStream(filePath).pipe(res); }
    const match = /bytes=(\d*)-(\d*)/.exec(range);
    if (!match) return res.status(416).end();
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1;
    if (start >= size || end < start) return res.status(416).set('Content-Range', `bytes */${size}`).end();
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } catch (err) {
    console.error('[streamIntroVideo]', err.message);
    res.status(500).json({ error: 'Could not load the video.' });
  }
}

// ── GET /api/profile/me ───────────────────────────────────────────────────────
async function getMyProfile(req, res) {
  try {
    const { rows } = await query(
      `SELECT p.*, u.email, u.membership_tier,
         EXISTS(SELECT 1 FROM member_intro_videos v WHERE v.user_id = p.user_id) AS has_intro_video
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profile not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[getMyProfile]', err.message);
    res.status(500).json({ error: 'Could not fetch profile.' });
  }
}

// ── PATCH /api/profile/me ────────────────────────────────────────────────────
async function updateMyProfile(req, res) {
  const {
    display_name, bio, location, state,
    interests,
    show_location, show_last_active, allow_messages_from,
    blur_photos, incognito, black_only_visibility,
    // Profile-setup fields (Profile/profile-setup.html)
    heading, looking_for,
    weight_label, weight_unit, weight_visible,
    height_label, height_unit,
    education, relationship_status, smoking, ethnicity, drinking, children, languages,
  } = req.body;

  // Incognito browsing is Black tier only — allow turning it back OFF at any
  // tier (e.g. after a downgrade), just never turning it on below Black.
  if (incognito === true && req.user.membership_tier !== 'black') {
    return res.status(403).json({ error: 'Incognito browsing requires a Black membership.', upgrade_required: true });
  }

  // Same rule as incognito: allow turning back OFF at any tier, never ON below Black.
  if (black_only_visibility === true && req.user.membership_tier !== 'black') {
    return res.status(403).json({ error: 'Black-only visibility requires a Black membership.', upgrade_required: true });
  }

  try {
    // Build dynamic SET clause — only update fields that were sent
    const updates = [];
    const values  = [];
    let   idx     = 1;

    const set = (col, val) => { updates.push(`${col} = $${idx++}`); values.push(val); };

    if (display_name       !== undefined) set('display_name',       display_name);
    if (bio                !== undefined) set('bio',                bio);
    if (location           !== undefined) set('location',           location);
    if (state              !== undefined) set('state',              state);
    if (interests          !== undefined) set('interests',          interests);
    if (show_location      !== undefined) set('show_location',      show_location);
    if (show_last_active   !== undefined) set('show_last_active',   show_last_active);
    if (allow_messages_from !== undefined) set('allow_messages_from', allow_messages_from);
    if (blur_photos         !== undefined) set('blur_photos',         blur_photos);
    if (incognito           !== undefined) set('incognito',           incognito);
    if (black_only_visibility !== undefined) set('black_only_visibility', black_only_visibility);

    // Geofenced privacy needs the viewer's own location geocoded too, so
    // whenever a member sets/changes their location text, best-effort
    // resolve it to coordinates in the background. Never blocks the save —
    // a member with no coordinates on file is just never excluded from
    // anyone else's discovery results (fails open, not closed).
    if (location !== undefined && location) {
      geocode(location)
        .then(coords => {
          if (!coords) return;
          return query('UPDATE profiles SET lat = $1, lon = $2 WHERE user_id = $3', [coords.lat, coords.lon, req.user.id]);
        })
        .catch(err => console.error('[updateMyProfile] location geocode failed:', err.message));
    }
    if (heading             !== undefined) set('heading',             heading);
    if (looking_for         !== undefined) set('looking_for',         looking_for);
    if (weight_label        !== undefined) set('weight_label',        weight_label);
    if (weight_unit         !== undefined) set('weight_unit',         weight_unit);
    if (weight_visible      !== undefined) set('weight_visible',      weight_visible);
    if (height_label        !== undefined) set('height_label',        height_label);
    if (height_unit         !== undefined) set('height_unit',         height_unit);
    if (education           !== undefined) set('education',           education);
    if (relationship_status !== undefined) set('relationship_status', relationship_status);
    if (smoking             !== undefined) set('smoking',             smoking);
    if (ethnicity           !== undefined) set('ethnicity',           ethnicity);
    if (drinking            !== undefined) set('drinking',            drinking);
    if (children            !== undefined) set('children',            children);
    if (languages           !== undefined) set('languages',           [...new Set(languages)]);

    if (!updates.length) {
      return res.status(400).json({ error: 'No fields to update.' });
    }

    values.push(req.user.id);

    // NOTE: column references inside a SET clause resolve to the row's
    // *pre-update* values in Postgres, so is_complete can't be computed in
    // this same UPDATE — it would always be one save behind. Recompute it
    // in a second pass instead, against the row as it now actually stands.
    const { rows } = await query(
      `UPDATE profiles SET ${updates.join(', ')}, updated_at = NOW()
       WHERE user_id = $${idx}
       RETURNING *`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: 'Profile not found.' });

    const completeRes = await query(
      `UPDATE profiles SET is_complete = (
         display_name IS NOT NULL AND display_name <> '' AND
         bio IS NOT NULL AND bio <> '' AND
         COALESCE(array_length(interests, 1), 0) > 0
       )
       WHERE user_id = $1
       RETURNING *`,
      [req.user.id]
    );

    res.json(completeRes.rows[0]);
  } catch (err) {
    console.error('[updateMyProfile]', err.message);
    res.status(500).json({ error: 'Could not update profile.' });
  }
}

// ── GET /api/profile/interest-tags ────────────────────────────────────────────
// Returns the member's own rated tags plus the fixed generic catalog, so the
// frontend never has to hardcode the tag list itself (it previously did, in
// four different places that had drifted out of sync with each other).
async function getMyInterestTags(req, res) {
  try {
    const { rows } = await query(
      `SELECT tag, level, is_custom FROM profile_interests WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.user.id]
    );
    res.json({
      tags: rows,
      generic_groups: GENERIC_TAG_GROUPS,
      levels: INTEREST_LEVELS,
      can_add_custom: TIER_RANK[req.user.membership_tier] >= TIER_RANK[CUSTOM_TAG_MIN_TIER],
    });
  } catch (err) {
    console.error('[getMyInterestTags]', err.message);
    res.status(500).json({ error: 'Could not fetch interest tags.' });
  }
}

// ── PUT /api/profile/interest-tags ────────────────────────────────────────────
// Full replace, same semantics as the old flat `interests` field. Custom tags
// (is_custom: true) require Gold or Black — enforced here, not just hidden in
// the UI, since the old `interests` field never validated tag values at all.
// profiles.interests (plain TEXT[] of tag names) is kept in sync in the same
// transaction so Discover/Search's existing array-overlap filters keep working
// unchanged — they only ever needed the names, never the level.
async function setMyInterestTags(req, res) {
  const { interests } = req.body;

  if (!Array.isArray(interests) || interests.length > 20) {
    return res.status(422).json({ error: 'Interests must be an array of up to 20 tags.' });
  }

  const canAddCustom = TIER_RANK[req.user.membership_tier] >= TIER_RANK[CUSTOM_TAG_MIN_TIER];

  // Validate + dedupe (last occurrence of a repeated tag wins) before
  // touching the database, so a bad entry rejects the whole request rather
  // than partially applying.
  const byTag = new Map();
  for (const entry of interests) {
    const tag = String(entry?.tag ?? '').trim();
    const level = entry?.level;
    const isCustom = Boolean(entry?.is_custom);

    if (!tag || tag.length > 50) {
      return res.status(422).json({ error: `Invalid tag: "${tag}".` });
    }
    if (!INTEREST_LEVELS.includes(level)) {
      return res.status(422).json({ error: `Invalid level for "${tag}". Must be one of: ${INTEREST_LEVELS.join(', ')}.` });
    }
    if (isCustom) {
      if (!canAddCustom) {
        return res.status(403).json({
          error: 'Custom interest tags require a Gold membership or higher.',
          upgrade_required: true,
        });
      }
    } else if (!GENERIC_TAGS.includes(tag)) {
      return res.status(422).json({ error: `"${tag}" isn't a recognized tag. Choose from the list, or upgrade to Gold to add your own.` });
    }

    byTag.set(tag, { tag, level, is_custom: isCustom });
  }
  const finalTags = [...byTag.values()];

  try {
    await withTransaction(async (client) => {
      await client.query('DELETE FROM profile_interests WHERE user_id = $1', [req.user.id]);
      for (const { tag, level, is_custom } of finalTags) {
        await client.query(
          `INSERT INTO profile_interests (user_id, tag, level, is_custom) VALUES ($1, $2, $3, $4)`,
          [req.user.id, tag, level, is_custom]
        );
      }
      // Keep the plain-string array in sync for Discover/Search filtering.
      await client.query('UPDATE profiles SET interests = $1 WHERE user_id = $2', [finalTags.map(t => t.tag), req.user.id]);
      await client.query(
        `UPDATE profiles SET is_complete = (
           display_name IS NOT NULL AND display_name <> '' AND
           bio IS NOT NULL AND bio <> '' AND
           COALESCE(array_length(interests, 1), 0) > 0
         )
         WHERE user_id = $1`,
        [req.user.id]
      );
    });

    res.json({ tags: finalTags });
  } catch (err) {
    console.error('[setMyInterestTags]', err.message);
    res.status(500).json({ error: 'Could not save interest tags.' });
  }
}

// ── POST /api/profile/avatar ──────────────────────────────────────────────────
async function uploadAvatar(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided.' });
    }

    const avatarUrl = `/uploads/avatars/${req.file.filename}`;

    // Delete old avatar file if it exists
    const { rows } = await query(
      'SELECT avatar_url FROM profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (rows[0]?.avatar_url) {
      const oldPath = path.join(__dirname, '..', rows[0].avatar_url);
      fs.unlink(oldPath, () => {}); // Non-blocking, ignore if already gone
    }

    await query(
      'UPDATE profiles SET avatar_url = $1, updated_at = NOW() WHERE user_id = $2',
      [avatarUrl, req.user.id]
    );

    res.json({ avatar_url: avatarUrl });
  } catch (err) {
    console.error('[uploadAvatar]', err.message);
    res.status(500).json({ error: 'Could not upload avatar.' });
  }
}

// ── GET /api/profile/:id ─────────────────────────────────────────────────────
// View another member's public profile — respects their privacy settings
async function getProfile(req, res) {
  const { id } = req.params;

  try {
    // Block check: don't show profile if either party has blocked the other
    const blockCheck = await query(
      `SELECT 1 FROM blocks
       WHERE (blocker_id = $1 AND blocked_id = $2)
          OR (blocker_id = $2 AND blocked_id = $1)`,
      [req.user.id, id]
    );
    if (blockCheck.rows.length) {
      return res.status(404).json({ error: 'Profile not found.' });
    }

    const { rows } = await query(
      `SELECT
         p.id, p.user_id, p.display_name, p.bio, p.avatar_url,
         p.interests, p.looking_for, p.heading, p.is_complete,
         p.education, p.relationship_status, p.smoking,
         p.ethnicity, p.drinking, p.children, p.languages,
         p.height_label, p.height_unit,
         p.blur_photos, p.black_only_visibility,
         CASE WHEN $3 = 'black' THEN EXISTS(SELECT 1 FROM member_intro_videos v WHERE v.user_id = p.user_id) ELSE FALSE END AS has_intro_video,
         DATE_PART('year', AGE(p.date_of_birth))::int AS age,
         -- Conditionally expose fields the member has chosen to hide
         CASE WHEN p.show_location    THEN p.location      ELSE NULL END AS location,
         CASE WHEN p.show_last_active THEN p.last_active_at ELSE NULL END AS last_active_at,
         CASE WHEN p.weight_visible   THEN p.weight_label   ELSE NULL END AS weight_label,
         CASE WHEN p.weight_visible   THEN p.weight_unit    ELSE NULL END AS weight_unit,
         p.allow_messages_from,
         u.membership_tier,
         u.created_at AS member_since,
         EXISTS(SELECT 1 FROM profile_likes WHERE liker_id = $2 AND liked_id = p.user_id) AS liked_by_me,
         COALESCE(
           (SELECT json_agg(json_build_object('id', ph.id, 'url', ph.url) ORDER BY ph.position)
            FROM profile_photos ph WHERE ph.user_id = p.user_id),
           '[]'
         ) AS photos,
         (SELECT COALESCE(json_agg(json_build_object('tag', pi.tag, 'level', pi.level)), '[]')
            FROM profile_interests pi WHERE pi.user_id = p.user_id) AS rated_interests,
         (SELECT status FROM photo_approvals WHERE owner_id = p.user_id AND viewer_id = $2) AS my_approval_status,
         (SELECT status FROM profile_view_requests WHERE owner_id = p.user_id AND requester_id = $2) AS my_view_request_status
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1
         AND u.is_active   = TRUE
         AND u.is_approved = TRUE
         -- Black-only visibility: a Free viewer 404s outright, same as a
         -- block (own-profile lookups never hit this route). Silver/Gold
         -- still get a row back — trimmed down below to a locked card with
         -- a request-to-view option, unless their request was approved.
         AND (NOT p.black_only_visibility OR $3 <> 'free')`,
      [id, req.user.id, req.user.membership_tier]
    );

    if (!rows.length) return res.status(404).json({ error: 'Profile not found.' });

    const profile = rows[0];

    // Black-only visibility: Silver/Gold see a locked card (name + avatar
    // only) until the member approves their view-request — everything else
    // about the profile stays withheld, stronger than blurred-photo mode's
    // photos-only restriction, matching what Discover/Search already show.
    const restricted = profile.black_only_visibility
      && req.user.membership_tier !== 'black'
      && id !== req.user.id
      && profile.my_view_request_status !== 'approved';
    profile.restricted = restricted;
    profile.view_request_status = profile.black_only_visibility ? (profile.my_view_request_status || null) : null;
    if (restricted) {
      profile.age = null;
      profile.bio = null;
      profile.interests = [];
      profile.looking_for = [];
      profile.heading = null;
      profile.education = null;
      profile.relationship_status = null;
      profile.smoking = null;
      profile.ethnicity = null;
      profile.drinking = null;
      profile.children = null;
      profile.languages = [];
      profile.height_label = null;
      profile.height_unit = null;
      profile.location = null;
      profile.last_active_at = null;
      profile.weight_label = null;
      profile.weight_unit = null;
      profile.allow_messages_from = null;
      profile.member_since = null;
      profile.photos = [];
      profile.rated_interests = [];
    }
    delete profile.black_only_visibility;
    delete profile.my_view_request_status;

    // Blurred-photo mode: withhold the real photo URLs entirely (not just a
    // CSS blur — the bytes never reach an unapproved viewer's browser) until
    // the owner has personally approved this specific viewer. Never applies
    // to the owner viewing their own profile (can't happen here — that's
    // getMyProfile — but guard anyway since $2 could equal $1 in theory).
    const photosVisible = !profile.blur_photos || profile.my_approval_status === 'approved' || id === req.user.id;
    profile.photos_hidden = !photosVisible;
    profile.photo_request_status = profile.my_approval_status || null;
    if (!photosVisible) {
      profile.avatar_url = null;
      profile.photos = [];
    }
    delete profile.blur_photos;
    delete profile.my_approval_status;

    // Record the view (upsert — re-viewing just bumps the timestamp) so it
    // shows up in the viewed party's "Viewed me" list. Never log a self-view,
    // never log it when the viewer has incognito browsing on, and never log
    // a locked-card lookup that showed nothing real — the review queue for
    // that is the view-request list, not "who viewed you".
    if (id !== req.user.id && !restricted) {
      query(
        `INSERT INTO profile_views (viewer_id, viewed_id, viewed_at)
         SELECT $1, $2, NOW()
         WHERE NOT COALESCE((SELECT incognito FROM profiles WHERE user_id = $1), FALSE)
         ON CONFLICT (viewer_id, viewed_id) DO UPDATE SET viewed_at = NOW()`,
        [req.user.id, id]
      ).catch(err => console.error('[getProfile] view log failed:', err.message));
    }

    res.json(profile);
  } catch (err) {
    console.error('[getProfile]', err.message);
    res.status(500).json({ error: 'Could not fetch profile.' });
  }
}

// ── POST /api/profile/:id/view-request ────────────────────────────────────────
// A Silver/Gold viewer asks a Black-only-visible member for access to their
// full profile. Free-tier viewers never reach this — getProfile 404s for
// them with no escalation path, same as before this feature existed.
// Re-requesting after a denial resets it back to pending, same rule as
// requestPhotoAccess.
async function requestProfileViewAccess(req, res) {
  const { id: ownerId } = req.params;
  if (ownerId === req.user.id) {
    return res.status(400).json({ error: 'You cannot request access to your own profile.' });
  }
  if (req.user.membership_tier === 'free') {
    return res.status(403).json({ error: 'Upgrade to Silver or Gold to request access to a Black-only-visible profile.', upgrade_required: true });
  }
  try {
    const { rows: ownerRows } = await query('SELECT black_only_visibility FROM profiles WHERE user_id = $1', [ownerId]);
    if (!ownerRows.length) return res.status(404).json({ error: 'Profile not found.' });
    if (!ownerRows[0].black_only_visibility) {
      return res.status(400).json({ error: "This member's profile isn't restricted." });
    }

    await query(
      `INSERT INTO profile_view_requests (owner_id, requester_id, status, created_at)
       VALUES ($1, $2, 'pending', NOW())
       ON CONFLICT (owner_id, requester_id) DO UPDATE
         SET status = 'pending', created_at = NOW(), responded_at = NULL
         WHERE profile_view_requests.status = 'denied'`,
      [ownerId, req.user.id]
    );
    res.json({ message: 'Request sent.' });
  } catch (err) {
    console.error('[requestProfileViewAccess]', err.message);
    res.status(500).json({ error: 'Could not send request.' });
  }
}

// ── GET /api/profile/view-requests ────────────────────────────────────────────
// Pending requests from Silver/Gold members asking to see MY full profile.
async function listProfileViewRequests(req, res) {
  try {
    const { rows } = await query(
      `SELECT pvr.requester_id, p.display_name, p.avatar_url, u.membership_tier, pvr.created_at
       FROM profile_view_requests pvr
       JOIN profiles p ON p.user_id = pvr.requester_id
       JOIN users u ON u.id = pvr.requester_id
       WHERE pvr.owner_id = $1 AND pvr.status = 'pending'
       ORDER BY pvr.created_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[listProfileViewRequests]', err.message);
    res.status(500).json({ error: 'Could not fetch view requests.' });
  }
}

// ── POST /api/profile/view-requests/:requesterId/respond ──────────────────────
async function respondProfileViewRequest(req, res) {
  const { requesterId } = req.params;
  const { status } = req.body; // 'approved' | 'denied'
  try {
    const { rows } = await query(
      `UPDATE profile_view_requests SET status = $1, responded_at = NOW()
       WHERE owner_id = $2 AND requester_id = $3
       RETURNING *`,
      [status, req.user.id, requesterId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Request not found.' });
    res.json({ message: `Request ${status}.` });
  } catch (err) {
    console.error('[respondProfileViewRequest]', err.message);
    res.status(500).json({ error: 'Could not update request.' });
  }
}

// ── GET /api/profile/:id/note ─────────────────────────────────────────────────
// Private notes (Gold+): a member's own note about another profile — never
// visible to the subject or anyone else. Tier is enforced by requireTier on
// the route, not just hidden client-side, same as custom interest tags and
// forum posting.
async function getProfileNote(req, res) {
  const { id: subjectId } = req.params;
  if (subjectId === req.user.id) {
    return res.status(400).json({ error: 'You cannot note your own profile.' });
  }
  try {
    const { rows } = await query(
      'SELECT body, updated_at FROM profile_notes WHERE author_id = $1 AND subject_id = $2',
      [req.user.id, subjectId]
    );
    res.json(rows[0] || { body: '', updated_at: null });
  } catch (err) {
    console.error('[getProfileNote]', err.message);
    res.status(500).json({ error: 'Could not fetch note.' });
  }
}

// ── PUT /api/profile/:id/note ─────────────────────────────────────────────────
async function saveProfileNote(req, res) {
  const { id: subjectId } = req.params;
  const { body } = req.body;
  if (subjectId === req.user.id) {
    return res.status(400).json({ error: 'You cannot note your own profile.' });
  }
  try {
    const { rows } = await query(
      `INSERT INTO profile_notes (author_id, subject_id, body, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (author_id, subject_id) DO UPDATE SET body = $3, updated_at = NOW()
       RETURNING body, updated_at`,
      [req.user.id, subjectId, body]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error('[saveProfileNote]', err.message);
    res.status(500).json({ error: 'Could not save note.' });
  }
}

// ── DELETE /api/profile/:id/note ──────────────────────────────────────────────
async function deleteProfileNote(req, res) {
  const { id: subjectId } = req.params;
  try {
    await query('DELETE FROM profile_notes WHERE author_id = $1 AND subject_id = $2', [req.user.id, subjectId]);
    res.json({ message: 'Note deleted.' });
  } catch (err) {
    console.error('[deleteProfileNote]', err.message);
    res.status(500).json({ error: 'Could not delete note.' });
  }
}

// ── Boost: temporary top-of-Discover placement ────────────────────────────────
// No payment processor exists to gate this behind a purchase (see project
// memory — Stripe was built then fully removed), so it's open to every tier
// and rationed by a cooldown instead of money.
const BOOST_DURATION_MINUTES = 30;
const BOOST_COOLDOWN_HOURS = 24;

function boostStatusFromRow(row) {
  const now = Date.now();
  const boostedUntil = row.boosted_until ? new Date(row.boosted_until) : null;
  const canBoostAt = row.last_boosted_at
    ? new Date(new Date(row.last_boosted_at).getTime() + BOOST_COOLDOWN_HOURS * 3600 * 1000)
    : null;
  return {
    boosted_until: boostedUntil && boostedUntil.getTime() > now ? boostedUntil.toISOString() : null,
    can_boost_at: canBoostAt && canBoostAt.getTime() > now ? canBoostAt.toISOString() : null,
  };
}

// ── GET /api/profile/boost ─────────────────────────────────────────────────────
async function getBoostStatus(req, res) {
  try {
    const { rows } = await query(
      'SELECT boosted_until, last_boosted_at FROM profiles WHERE user_id = $1',
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profile not found.' });
    res.json(boostStatusFromRow(rows[0]));
  } catch (err) {
    console.error('[getBoostStatus]', err.message);
    res.status(500).json({ error: 'Could not fetch boost status.' });
  }
}

// ── POST /api/profile/boost ────────────────────────────────────────────────────
async function activateBoost(req, res) {
  try {
    const { rows } = await query(
      `UPDATE profiles SET boosted_until = NOW() + ($1 || ' minutes')::INTERVAL, last_boosted_at = NOW()
       WHERE user_id = $2
         AND (last_boosted_at IS NULL OR last_boosted_at <= NOW() - ($3 || ' hours')::INTERVAL)
       RETURNING boosted_until, last_boosted_at`,
      [BOOST_DURATION_MINUTES, req.user.id, BOOST_COOLDOWN_HOURS]
    );
    if (!rows.length) {
      const { rows: current } = await query(
        'SELECT boosted_until, last_boosted_at FROM profiles WHERE user_id = $1',
        [req.user.id]
      );
      return res.status(429).json({
        error: 'You can only boost once every 24 hours.',
        ...boostStatusFromRow(current[0]),
      });
    }
    res.json(boostStatusFromRow(rows[0]));
  } catch (err) {
    console.error('[activateBoost]', err.message);
    res.status(500).json({ error: 'Could not activate boost.' });
  }
}

// ── POST /api/profile/:id/block ───────────────────────────────────────────────
async function blockUser(req, res) {
  const { id: blockedId } = req.params;

  if (blockedId === req.user.id) {
    return res.status(400).json({ error: 'You cannot block yourself.' });
  }

  try {
    await query(
      `INSERT INTO blocks (blocker_id, blocked_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [req.user.id, blockedId]
    );
    res.json({ message: 'User blocked.' });
  } catch (err) {
    console.error('[blockUser]', err.message);
    res.status(500).json({ error: 'Could not block user.' });
  }
}

// ── DELETE /api/profile/:id/block ────────────────────────────────────────────
async function unblockUser(req, res) {
  const { id: blockedId } = req.params;
  try {
    await query(
      'DELETE FROM blocks WHERE blocker_id = $1 AND blocked_id = $2',
      [req.user.id, blockedId]
    );
    res.json({ message: 'User unblocked.' });
  } catch (err) {
    console.error('[unblockUser]', err.message);
    res.status(500).json({ error: 'Could not unblock user.' });
  }
}

// ── GET /api/profile/blocked ──────────────────────────────────────────────────
// The viewer's own block list, for a "Blocked members" management screen.
// Blocked profiles are otherwise invisible everywhere else in the app (they
// 404 from getProfile, and are excluded from Discover/Search), so this is
// the only place a member can see who they've blocked and undo it.
async function listBlocked(req, res) {
  try {
    const { rows } = await query(
      `SELECT u.id AS user_id, p.display_name, p.avatar_url, b.created_at AS blocked_at
       FROM blocks b
       JOIN users u ON u.id = b.blocked_id
       JOIN profiles p ON p.user_id = b.blocked_id
       WHERE b.blocker_id = $1
       ORDER BY b.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[listBlocked]', err.message);
    res.status(500).json({ error: 'Could not fetch blocked members.' });
  }
}

// ── POST /api/profile/:id/photo-request ───────────────────────────────────────
// A viewer asks to see an owner's real photo while blurred-photo mode is on.
// Re-requesting after a denial resets it back to pending — a denial isn't
// permanent, it's just "not yet."
async function requestPhotoAccess(req, res) {
  const { id: ownerId } = req.params;
  if (ownerId === req.user.id) {
    return res.status(400).json({ error: 'You cannot request access to your own photos.' });
  }
  try {
    const { rows: ownerRows } = await query('SELECT blur_photos FROM profiles WHERE user_id = $1', [ownerId]);
    if (!ownerRows.length) return res.status(404).json({ error: 'Profile not found.' });
    if (!ownerRows[0].blur_photos) {
      return res.status(400).json({ error: "This member's photos aren't blurred." });
    }

    await query(
      `INSERT INTO photo_approvals (owner_id, viewer_id, status, created_at)
       VALUES ($1, $2, 'pending', NOW())
       ON CONFLICT (owner_id, viewer_id) DO UPDATE
         SET status = 'pending', created_at = NOW(), responded_at = NULL
         WHERE photo_approvals.status = 'denied'`,
      [ownerId, req.user.id]
    );
    res.json({ message: 'Request sent.' });
  } catch (err) {
    console.error('[requestPhotoAccess]', err.message);
    res.status(500).json({ error: 'Could not send request.' });
  }
}

// ── GET /api/profile/photo-requests ───────────────────────────────────────────
// Pending requests from other members asking to see MY real photo.
async function listPhotoRequests(req, res) {
  try {
    const { rows } = await query(
      `SELECT pa.viewer_id, p.display_name, p.avatar_url, pa.created_at
       FROM photo_approvals pa
       JOIN profiles p ON p.user_id = pa.viewer_id
       WHERE pa.owner_id = $1 AND pa.status = 'pending'
       ORDER BY pa.created_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[listPhotoRequests]', err.message);
    res.status(500).json({ error: 'Could not fetch photo requests.' });
  }
}

// ── POST /api/profile/photo-requests/:viewerId/respond ────────────────────────
async function respondPhotoRequest(req, res) {
  const { viewerId } = req.params;
  const { status } = req.body; // 'approved' | 'denied'
  try {
    const { rows } = await query(
      `UPDATE photo_approvals SET status = $1, responded_at = NOW()
       WHERE owner_id = $2 AND viewer_id = $3
       RETURNING *`,
      [status, req.user.id, viewerId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Request not found.' });
    res.json({ message: `Request ${status}.` });
  } catch (err) {
    console.error('[respondPhotoRequest]', err.message);
    res.status(500).json({ error: 'Could not update request.' });
  }
}

// ── POST /api/profile/:id/report ──────────────────────────────────────────────
async function reportUser(req, res) {
  const { id: reportedId } = req.params;
  const { reason } = req.body;

  if (reportedId === req.user.id) {
    return res.status(400).json({ error: 'You cannot report yourself.' });
  }

  try {
    await query(
      `INSERT INTO reports (reporter_id, reported_id, reason)
       VALUES ($1, $2, $3)`,
      [req.user.id, reportedId, reason]
    );
    res.status(201).json({ message: 'Report submitted. Our team will review it.' });
  } catch (err) {
    console.error('[reportUser]', err.message);
    res.status(500).json({ error: 'Could not submit report.' });
  }
}

// ── POST /api/profile/privacy-requests ────────────────────────────────────────
// Backs Dashboard/Privacy.html's data-subject request center (access,
// correct, restrict, object, portability, delete). Every type lands in the
// same admin-reviewed queue as user reports — see adminController for the
// review side, including that 'delete' is the one type an admin resolving
// it actually executes rather than just marking done.
async function createPrivacyRequest(req, res) {
  const { type, reason } = req.body;
  try {
    await query(
      `INSERT INTO privacy_requests (user_id, type, reason)
       VALUES ($1, $2, $3)`,
      [req.user.id, type, reason || null]
    );
    res.status(201).json({ message: 'Request received. Our team will review it within 30 days.' });
  } catch (err) {
    console.error('[createPrivacyRequest]', err.message);
    res.status(500).json({ error: 'Could not submit request.' });
  }
}

// ── Geofenced privacy (Black tier only) ───────────────────────────────────────
// Each row is a real geocoded zone; presence of any row is what actually
// excludes this member from discovery for anyone browsing from inside it
// (see discoverController.js) — the frontend toggle is just an expand/collapse
// convenience, not a separate on/off flag stored anywhere.

// ── GET /api/profile/geofences ────────────────────────────────────────────────
async function listGeofences(req, res) {
  try {
    const { rows } = await query(
      `SELECT id, label, address, radius_miles FROM profile_geofences
       WHERE user_id = $1 ORDER BY created_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[listGeofences]', err.message);
    res.status(500).json({ error: 'Could not fetch hidden zones.' });
  }
}

// ── POST /api/profile/geofences ───────────────────────────────────────────────
async function addGeofence(req, res) {
  const { label, address, radius_miles } = req.body;
  try {
    const { rows: existing } = await query('SELECT COUNT(*) FROM profile_geofences WHERE user_id = $1', [req.user.id]);
    if (parseInt(existing[0].count, 10) >= 10) {
      return res.status(400).json({ error: 'You can have up to 10 hidden zones.' });
    }

    let coords;
    try {
      coords = await geocode(address);
    } catch (err) {
      console.error('[addGeofence] geocode failed:', err.message);
      return res.status(502).json({ error: 'Could not reach the geocoding service. Try again shortly.' });
    }
    if (!coords) {
      return res.status(400).json({ error: `Could not find "${address}" — try a more specific address.` });
    }

    const { rows } = await query(
      `INSERT INTO profile_geofences (user_id, label, address, lat, lon, radius_miles)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, label, address, radius_miles`,
      [req.user.id, label, address, coords.lat, coords.lon, radius_miles]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[addGeofence]', err.message);
    res.status(500).json({ error: 'Could not save hidden zone.' });
  }
}

// ── DELETE /api/profile/geofences/:geofenceId ─────────────────────────────────
async function deleteGeofence(req, res) {
  try {
    const { rows } = await query(
      'DELETE FROM profile_geofences WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.geofenceId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Hidden zone not found.' });
    res.json({ message: 'Removed.' });
  } catch (err) {
    console.error('[deleteGeofence]', err.message);
    res.status(500).json({ error: 'Could not remove hidden zone.' });
  }
}

module.exports = {
  getMyProfile, updateMyProfile, uploadAvatar,
  uploadIntroVideo, deleteIntroVideo, streamIntroVideo,
  getProfile, blockUser, unblockUser, reportUser, listBlocked,
  requestPhotoAccess, listPhotoRequests, respondPhotoRequest,
  requestProfileViewAccess, listProfileViewRequests, respondProfileViewRequest,
  getProfileNote, saveProfileNote, deleteProfileNote,
  getBoostStatus, activateBoost,
  createPrivacyRequest,
  getMyInterestTags, setMyInterestTags,
  listGeofences, addGeofence, deleteGeofence,
};
