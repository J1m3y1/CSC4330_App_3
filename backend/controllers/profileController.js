'use strict';

const path   = require('path');
const fs     = require('fs');
const { query } = require('../config/db');

// ── GET /api/profile/me ───────────────────────────────────────────────────────
async function getMyProfile(req, res) {
  try {
    const { rows } = await query(
      `SELECT p.*, u.email, u.membership_tier
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
    display_name, bio, location,
    interests,
    show_location, show_last_active, allow_messages_from,
    // Profile-setup fields (Dashboard/profile-setup.html)
    heading, looking_for,
    weight_label, weight_unit, weight_visible,
    height_label, height_unit,
    education, relationship_status, smoking,
  } = req.body;

  try {
    // Build dynamic SET clause — only update fields that were sent
    const updates = [];
    const values  = [];
    let   idx     = 1;

    const set = (col, val) => { updates.push(`${col} = $${idx++}`); values.push(val); };

    if (display_name       !== undefined) set('display_name',       display_name);
    if (bio                !== undefined) set('bio',                bio);
    if (location           !== undefined) set('location',           location);
    if (interests          !== undefined) set('interests',          interests);
    if (show_location      !== undefined) set('show_location',      show_location);
    if (show_last_active   !== undefined) set('show_last_active',   show_last_active);
    if (allow_messages_from !== undefined) set('allow_messages_from', allow_messages_from);
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
         array_length(interests, 1) > 0
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
         p.interests, p.is_complete,
         -- Conditionally expose location based on privacy setting
         CASE WHEN p.show_location    THEN p.location      ELSE NULL END AS location,
         CASE WHEN p.show_last_active THEN p.last_active_at ELSE NULL END AS last_active_at,
         p.allow_messages_from,
         u.membership_tier,
         COALESCE(
           (SELECT json_agg(json_build_object('id', ph.id, 'url', ph.url) ORDER BY ph.position)
            FROM profile_photos ph WHERE ph.user_id = p.user_id),
           '[]'
         ) AS photos
       FROM profiles p
       JOIN users u ON u.id = p.user_id
       WHERE p.user_id = $1
         AND u.is_active   = TRUE
         AND u.is_approved = TRUE`,
      [id]
    );

    if (!rows.length) return res.status(404).json({ error: 'Profile not found.' });

    // Record the view (upsert — re-viewing just bumps the timestamp) so it
    // shows up in the viewed party's "Viewed me" list. Never log a self-view.
    if (id !== req.user.id) {
      query(
        `INSERT INTO profile_views (viewer_id, viewed_id, viewed_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (viewer_id, viewed_id) DO UPDATE SET viewed_at = NOW()`,
        [req.user.id, id]
      ).catch(err => console.error('[getProfile] view log failed:', err.message));
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('[getProfile]', err.message);
    res.status(500).json({ error: 'Could not fetch profile.' });
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

module.exports = {
  getMyProfile, updateMyProfile, uploadAvatar,
  getProfile, blockUser, unblockUser, reportUser,
  createPrivacyRequest,
};
