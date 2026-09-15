'use strict';

const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const crypto  = require('crypto');
const fs      = require('fs');
const { query, withTransaction } = require('../config/db');
const { sendMail } = require('../utils/mailer');
const { verifyProofToken } = require('./phoneController');
const { isConfigured: veriffConfigured } = require('../config/veriff');

// ── Cookie helpers ────────────────────────────────────────────────────────────

const COOKIE_OPTS = {
  httpOnly: true,          // JS cannot read this cookie — blocks XSS token theft
  secure:   process.env.NODE_ENV === 'production', // HTTPS only in prod
  sameSite: 'strict',      // No cross-site sending — blocks CSRF
  path:     '/',
};

function issueTokens(res, userId) {
  const accessToken = jwt.sign(
    { sub: userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );

  const refreshToken = jwt.sign(
    { sub: userId },
    process.env.REFRESH_TOKEN_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
  );

  // Access token: short-lived, in-memory readable via cookie
  res.cookie('access_token', accessToken, {
    ...COOKIE_OPTS,
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  // Refresh token: long-lived, stored as hash in DB
  res.cookie('refresh_token', refreshToken, {
    ...COOKIE_OPTS,
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/api/auth/refresh',         // Only sent to refresh endpoint
  });

  return refreshToken;
}

function clearTokenCookies(res) {
  res.clearCookie('access_token',  { ...COOKIE_OPTS });
  res.clearCookie('refresh_token', { ...COOKIE_OPTS, path: '/api/auth/refresh' });
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Registration is rejected in several places below (duplicate email, under
// 18, bad phone proof) — by the time any of those run, multer has already
// written the uploaded ID to disk, since it's route middleware ahead of this
// controller. An orphaned file with no DB row is a stray sensitive document
// sitting on disk for no reason, so every rejection path deletes it first.
function cleanupUploadedId(req) {
  if (req.file) fs.unlink(req.file.path, () => {});
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
async function register(req, res) {
  const { email, password, display_name, full_name, date_of_birth, phone, phone_verification_token, location, veriff_session_id } = req.body;

  try {
    // 1. Identity is required — no exceptions. When Veriff is configured
    // this means an approved, not-yet-used verification session (real
    // automated document+selfie check, replacing the old manual admin
    // review — see migration 024); when it isn't configured, fall back to
    // the original raw-file-upload path so sign-up still works without a
    // Veriff account, same as every other optional integration here.
    let veriffSession = null;
    if (veriffConfigured) {
      if (!veriff_session_id) {
        return res.status(422).json({ error: 'Identity verification is required. Please complete the verification step.' });
      }
      const { rows } = await query(
        `SELECT id, status, consumed_at FROM veriff_sessions WHERE id = $1 AND email = $2`,
        [veriff_session_id, email]
      );
      veriffSession = rows[0];
      if (!veriffSession || veriffSession.consumed_at) {
        return res.status(422).json({ error: 'Identity verification session not found. Please verify your identity again.' });
      }
      if (veriffSession.status !== 'approved') {
        return res.status(422).json({
          error: veriffSession.status === 'declined'
            ? 'Identity verification was declined. Please try again or contact support.'
            : 'Identity verification is still processing. Please wait for it to finish before submitting.',
        });
      }
    } else if (!req.file) {
      return res.status(422).json({ error: 'A government-issued ID (JPEG, PNG, or PDF) is required.' });
    }

    // 2. Check email not already taken
    const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length) {
      cleanupUploadedId(req);
      return res.status(409).json({ error: 'An account with that email already exists.' });
    }

    // 3. Enforce minimum age (18+) server-side — never trust the client
    const dob = new Date(date_of_birth);
    const age = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 18) {
      cleanupUploadedId(req);
      return res.status(422).json({ error: 'You must be 18 or older to join Fantasi.' });
    }

    // 3b. A phone number is only ever marked verified server-side, via a
    // signed proof issued by POST /api/phone/verify-code — never because the
    // client simply says so. If a phone was submitted but its proof is
    // missing, wrong, or expired, reject rather than silently storing an
    // unverified number as if it were verified.
    let phoneVerified = false;
    if (phone) {
      phoneVerified = verifyProofToken(phone_verification_token, phone);
      if (!phoneVerified) {
        cleanupUploadedId(req);
        return res.status(422).json({ error: 'Phone verification expired or is invalid. Please verify your number again.' });
      }
    }

    // 4. Hash password — cost factor 12 (strong but < 1s on modern hardware)
    const password_hash = await bcrypt.hash(password, 12);

    // 5. Insert user + profile + ID document record as one real transaction
    //    (single connection — see withTransaction) so a failure never leaves
    //    a user with no profile, or an application with no ID on file.
    await withTransaction(async (client) => {
      const userRes = await client.query(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id`,
        [email, password_hash]
      );
      const userId = userRes.rows[0].id;

      await client.query(
        `INSERT INTO profiles (user_id, display_name, full_name, date_of_birth, phone, phone_verified, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [userId, display_name, full_name || null, date_of_birth, phone || null, phoneVerified, location || null]
      );

      if (veriffSession) {
        // Atomic consume-once, re-checked here (not just in the earlier
        // read outside the transaction) so two concurrent submits of the
        // same session can't both succeed — only the first UPDATE finds a
        // still-unconsumed, still-approved row and returns one.
        const consumed = await client.query(
          `UPDATE veriff_sessions SET consumed_at = NOW()
           WHERE id = $1 AND status = 'approved' AND consumed_at IS NULL
           RETURNING id`,
          [veriffSession.id]
        );
        if (!consumed.rows.length) {
          throw Object.assign(new Error('Identity verification session was already used or is no longer valid.'), { status: 422 });
        }
        await client.query(
          `INSERT INTO identity_documents (user_id, veriff_session_id, status, reviewed_at)
           VALUES ($1, $2, 'approved', NOW())`,
          [userId, veriffSession.id]
        );
      } else {
        await client.query(
          `INSERT INTO identity_documents (user_id, storage_key, original_filename, mime_type)
           VALUES ($1, $2, $3, $4)`,
          [userId, req.file.filename, req.file.originalname, req.file.mimetype]
        );
      }
    });

    // 6. New accounts need admin approval before accessing dashboard
    return res.status(201).json({
      message: 'Registration received. Your application is pending review.',
      pending_approval: true,
    });

  } catch (err) {
    cleanupUploadedId(req);
    console.error('[register]', err.message);
    if (err.status === 422) return res.status(422).json({ error: err.message });
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;

  try {
    // Always run bcrypt.compare even if user not found — prevents timing attacks
    const { rows } = await query(
      'SELECT id, password_hash, is_active, is_approved FROM users WHERE email = $1',
      [email]
    );

    const user         = rows[0];
    const dummyHash    = '$2a$12$notarealhashjusttopreventtimingattacksXXXXXXXXXXXXXX';
    const hashToCheck  = user ? user.password_hash : dummyHash;
    const passwordMatch = await bcrypt.compare(password, hashToCheck);

    if (!user || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated.' });
    }

    if (!user.is_approved) {
      return res.status(403).json({
        error: 'Your account is pending approval.',
        pending_approval: true,
      });
    }

    // Issue tokens
    const refreshToken = issueTokens(res, user.id);

    // Store refresh token hash in DB (rotation on next refresh)
    await query(
      'UPDATE users SET refresh_token_hash = $1, last_login_at = NOW() WHERE id = $2',
      [hashToken(refreshToken), user.id]
    );

    res.json({ message: 'Signed in successfully.' });

  } catch (err) {
    console.error('[login]', err.message);
    res.status(500).json({ error: 'Sign in failed. Please try again.' });
  }
}

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
async function refresh(req, res) {
  const token = req.cookies?.refresh_token;
  if (!token) {
    return res.status(401).json({ error: 'No refresh token.' });
  }

  try {
    let payload;
    try {
      payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' });
    }

    // Verify token matches what's stored (detects token theft / reuse after rotation)
    const { rows } = await query(
      'SELECT id, is_active, refresh_token_hash FROM users WHERE id = $1',
      [payload.sub]
    );

    const user = rows[0];
    if (!user || !user.is_active || user.refresh_token_hash !== hashToken(token)) {
      clearTokenCookies(res);
      return res.status(401).json({ error: 'Session invalid. Please sign in again.' });
    }

    // Rotate: issue new pair, invalidate old refresh token
    const newRefreshToken = issueTokens(res, user.id);
    await query(
      'UPDATE users SET refresh_token_hash = $1 WHERE id = $2',
      [hashToken(newRefreshToken), user.id]
    );

    res.json({ message: 'Token refreshed.' });

  } catch (err) {
    console.error('[refresh]', err.message);
    res.status(500).json({ error: 'Could not refresh session.' });
  }
}

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
async function logout(req, res) {
  try {
    const token = req.cookies?.refresh_token;
    if (token) {
      let payload;
      try { payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET); } catch { /* expired is fine */ }
      if (payload?.sub) {
        // Invalidate the stored refresh token so it can't be reused
        await query('UPDATE users SET refresh_token_hash = NULL WHERE id = $1', [payload.sub]);
      }
    }
  } catch (err) {
    console.error('[logout]', err.message);
  } finally {
    clearTokenCookies(res);
    res.json({ message: 'Signed out.' });
  }
}

// ── POST /api/auth/forgot-password ───────────────────────────────────────────
async function forgotPassword(req, res) {
  const { email } = req.body;

  // Always return same response — don't reveal whether email exists
  const SAFE_RESPONSE = { message: 'If that email is registered, a reset link has been sent.' };

  try {
    const { rows } = await query('SELECT id FROM users WHERE email = $1', [email]);
    if (!rows.length) return res.json(SAFE_RESPONSE);

    const rawToken    = crypto.randomBytes(32).toString('hex');
    const tokenHash   = hashToken(rawToken);
    const expiresAt   = new Date(
      Date.now() + (parseInt(process.env.RESET_TOKEN_EXPIRES_MINUTES, 10) || 30) * 60 * 1000
    );

    await query(
      'UPDATE users SET reset_token_hash = $1, reset_token_expires = $2 WHERE id = $3',
      [tokenHash, expiresAt, rows[0].id]
    );

    const resetUrl = `${process.env.APP_URL || ''}/SignInProcess/forgot-password.html?token=${rawToken}`;
    await sendMail(
      email,
      'Reset your Fantasi password',
      `<p>Someone requested a password reset for this account.</p>
       <p><a href="${resetUrl}">Choose a new password</a> — this link expires in ${parseInt(process.env.RESET_TOKEN_EXPIRES_MINUTES, 10) || 30} minutes.</p>
       <p>If this wasn't you, no action is needed.</p>`
    );

    res.json(SAFE_RESPONSE);

  } catch (err) {
    console.error('[forgotPassword]', err.message);
    res.json(SAFE_RESPONSE); // Still return safe response on error
  }
}

// ── POST /api/auth/reset-password ────────────────────────────────────────────
async function resetPassword(req, res) {
  const { token, password } = req.body;

  try {
    const tokenHash = hashToken(token);

    const { rows } = await query(
      `SELECT id FROM users
       WHERE reset_token_hash = $1
         AND reset_token_expires > NOW()
         AND is_active = TRUE`,
      [tokenHash]
    );

    if (!rows.length) {
      return res.status(400).json({ error: 'Reset link is invalid or has expired.' });
    }

    const newHash = await bcrypt.hash(password, 12);

    await query(
      `UPDATE users
       SET password_hash = $1,
           reset_token_hash = NULL,
           reset_token_expires = NULL,
           refresh_token_hash = NULL   -- invalidate all sessions on password change
       WHERE id = $2`,
      [newHash, rows[0].id]
    );

    // Clear any active session cookies
    clearTokenCookies(res);

    res.json({ message: 'Password updated successfully. Please sign in.' });

  } catch (err) {
    console.error('[resetPassword]', err.message);
    res.status(500).json({ error: 'Could not reset password. Please try again.' });
  }
}

// ── POST /api/auth/change-password ────────────────────────────────────────────
// For an authenticated user changing their own password from Profile.html —
// distinct from resetPassword, which is for someone who's lost access and is
// coming in via an emailed token instead.
async function changePassword(req, res) {
  const { current_password, new_password } = req.body;

  try {
    const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });

    const matches = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!matches) return res.status(401).json({ error: 'Current password is incorrect.' });

    const newHash = await bcrypt.hash(new_password, 12);
    await query(
      // Invalidate other sessions, same as a token-based reset — a password
      // change is exactly the moment an old, possibly-compromised session
      // should stop working.
      `UPDATE users SET password_hash = $1, refresh_token_hash = NULL WHERE id = $2`,
      [newHash, req.user.id]
    );

    clearTokenCookies(res);
    res.json({ message: 'Password updated. Please sign in again.' });
  } catch (err) {
    console.error('[changePassword]', err.message);
    res.status(500).json({ error: 'Could not change password.' });
  }
}

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
async function me(req, res) {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.role, u.membership_tier, u.is_approved, u.welcome_seen_at,
              p.display_name, p.avatar_url, p.is_complete
       FROM users u
       LEFT JOIN profiles p ON p.user_id = u.id
       WHERE u.id = $1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[me]', err.message);
    res.status(500).json({ error: 'Could not fetch user.' });
  }
}

// ── POST /api/auth/welcome-seen ─────────────────────────────────────────────
// Marks the first-sign-in welcome interstitial (Dashboard/Welcome.html) as
// shown, permanently — idempotent, since a member landing there twice
// (back button, direct URL) shouldn't error.
async function markWelcomeSeen(req, res) {
  try {
    await query(
      'UPDATE users SET welcome_seen_at = COALESCE(welcome_seen_at, NOW()) WHERE id = $1',
      [req.user.id]
    );
    res.json({ message: 'Welcome marked as seen.' });
  } catch (err) {
    console.error('[markWelcomeSeen]', err.message);
    res.status(500).json({ error: 'Could not update.' });
  }
}

module.exports = {
  register, login, refresh, logout, forgotPassword, resetPassword, changePassword, me,
  markWelcomeSeen,
};
