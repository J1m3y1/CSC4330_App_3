'use strict';

const jwt = require('jsonwebtoken');
const { verifyService, isConfigured } = require('../config/twilio');

// Phone verification happens during the sign-up wizard, before any account
// (and therefore any session) exists — these routes are intentionally
// public. A successful verify-code call returns a short-lived, signed proof
// token instead of writing anything to the database; the client carries
// that token into POST /api/auth/register, which is the only place a
// verified phone actually gets persisted. This keeps "phone is verified"
// something only the server can assert (it's a signed JWT), never something
// the client could just claim.

const PROOF_EXPIRES_IN = '15m';

// ── POST /api/phone/send-code ──────────────────────────────────────────────────
async function sendCode(req, res) {
  const { phone } = req.body;

  if (!isConfigured) {
    return res.status(503).json({
      error: 'Phone verification is not configured yet. Set TWILIO_* in the backend .env to enable it.',
    });
  }

  try {
    await verifyService.verifications.create({ to: phone, channel: 'sms' });
    res.json({ message: 'Code sent.' });
  } catch (err) {
    console.error('[phone.sendCode]', err.message);
    // Twilio's own error messages are safe to relay — they're things like
    // "Invalid parameter `To`", not anything sensitive.
    res.status(400).json({ error: err.message || 'Could not send verification code.' });
  }
}

// ── POST /api/phone/verify-code ────────────────────────────────────────────────
async function verifyCode(req, res) {
  const { phone, code } = req.body;

  if (!isConfigured) {
    return res.status(503).json({ error: 'Phone verification is not configured yet.' });
  }

  try {
    const check = await verifyService.verificationChecks.create({ to: phone, code });

    if (check.status !== 'approved') {
      return res.status(400).json({ error: 'That code is incorrect or has expired.' });
    }

    const proof = jwt.sign(
      { phone, type: 'phone_verification' },
      process.env.JWT_SECRET,
      { expiresIn: PROOF_EXPIRES_IN }
    );

    res.json({ message: 'Phone verified.', verification_token: proof });
  } catch (err) {
    console.error('[phone.verifyCode]', err.message);
    res.status(400).json({ error: err.message || 'Could not verify code.' });
  }
}

/**
 * Used by authController.register — validates a verification_token against
 * a specific phone number. Returns true only if the token is a genuine,
 * unexpired proof for exactly that phone number.
 */
function verifyProofToken(token, phone) {
  if (!token) return false;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return payload.type === 'phone_verification' && payload.phone === phone;
  } catch {
    return false;
  }
}

module.exports = { sendCode, verifyCode, verifyProofToken };
