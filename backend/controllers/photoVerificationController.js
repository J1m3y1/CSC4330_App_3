'use strict';

const fs = require('fs');
const { query } = require('../config/db');

// A short, hand-writable code — excludes visually ambiguous characters
// (0/O, 1/I/l) since a human admin has to read it off a handwritten note in
// the selfie. Not stored server-side on generation: its only job is to be
// unpredictable enough that it couldn't already be written on a photo taken
// before the member requested it, which a random code accomplishes whether
// or not we keep a record of having issued it — the actual proof lives in
// the submitted photo an admin looks at, not in comparing against a stored
// value.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateChallengeCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

// ── GET /api/profile/photo-verification/challenge ───────────────────────────
async function getChallenge(_req, res) {
  res.json({ code: generateChallengeCode() });
}

// ── POST /api/profile/photo-verification ─────────────────────────────────────
async function submitPhotoVerification(req, res) {
  const cleanupUpload = () => { if (req.file) fs.unlink(req.file.path, () => {}); };

  if (!req.file) {
    return res.status(422).json({ error: 'A selfie photo is required.' });
  }

  try {
    const { rows: photoRows } = await query(
      'SELECT COUNT(*)::int AS count FROM profile_photos WHERE user_id = $1',
      [req.user.id]
    );
    if (photoRows[0].count === 0) {
      cleanupUpload();
      return res.status(422).json({ error: 'Add at least one profile photo before requesting photo verification.' });
    }

    const { rows: pendingRows } = await query(
      `SELECT id FROM photo_verification_requests WHERE user_id = $1 AND status = 'pending'`,
      [req.user.id]
    );
    if (pendingRows.length) {
      cleanupUpload();
      return res.status(409).json({ error: 'You already have a photo verification request pending review.' });
    }

    await query(
      `INSERT INTO photo_verification_requests (user_id, storage_key, challenge_code)
       VALUES ($1, $2, $3)`,
      [req.user.id, req.file.filename, req.body.challenge_code]
    );

    res.status(201).json({ message: 'Photo verification submitted for review.' });
  } catch (err) {
    cleanupUpload();
    console.error('[photoVerification.submit]', err.message);
    res.status(500).json({ error: 'Could not submit photo verification.' });
  }
}

// ── GET /api/profile/photo-verification/status ───────────────────────────────
async function getPhotoVerificationStatus(req, res) {
  try {
    const { rows: profileRows } = await query(
      'SELECT photo_verified FROM profiles WHERE user_id = $1',
      [req.user.id]
    );
    const { rows: requestRows } = await query(
      `SELECT status, created_at FROM photo_verification_requests
       WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({
      photo_verified: profileRows[0]?.photo_verified || false,
      latest_request: requestRows[0] || null,
    });
  } catch (err) {
    console.error('[photoVerification.getStatus]', err.message);
    res.status(500).json({ error: 'Could not check photo verification status.' });
  }
}

module.exports = { getChallenge, submitPhotoVerification, getPhotoVerificationStatus };
