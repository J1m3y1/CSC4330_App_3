'use strict';

/**
 * Veriff identity verification client. Optional at boot, same as Twilio
 * Verify (see config/twilio.js) — a fresh checkout with no Veriff account
 * yet should still run the rest of the app. Routes that need it check
 * `isConfigured` and return 503 rather than crash; authController.register
 * falls back to the old manual-upload-then-admin-review path when this is
 * unconfigured, so sign-up itself never hard-depends on having a Veriff
 * account.
 *
 * Veriff signs every Sessions API request, and every decision webhook it
 * sends back, with HMAC-SHA256 over the raw request/response body using the
 * shared secret key (never the API key) — sign() and verifySignature()
 * below are the same primitive used both directions.
 */

const crypto = require('crypto');

const isConfigured = Boolean(
  process.env.VERIFF_API_KEY &&
  process.env.VERIFF_SECRET_KEY
);

// Veriff's standard REST API host. Some accounts are provisioned on a
// region-specific host instead — override via VERIFF_BASE_URL if Veriff's
// own dashboard gives you a different one for your account.
const BASE_URL = process.env.VERIFF_BASE_URL || 'https://stationapi.veriff.com';

function sign(payloadString) {
  return crypto
    .createHmac('sha256', process.env.VERIFF_SECRET_KEY)
    .update(payloadString, 'utf8')
    .digest('hex');
}

// Timing-safe compare — a signature check that short-circuits on the first
// mismatched byte leaks how much of the signature an attacker got right.
function verifySignature(payloadString, signatureHeader) {
  if (!signatureHeader) return false;
  const expected = sign(payloadString);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(String(signatureHeader), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { isConfigured, BASE_URL, sign, verifySignature };
