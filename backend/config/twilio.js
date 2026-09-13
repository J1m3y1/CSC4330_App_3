'use strict';

/**
 * Twilio Verify client. Phone verification is entirely optional at boot —
 * a fresh checkout with no Twilio account yet should still run the rest of
 * the app. Routes that need it check `isConfigured` and return 503 rather
 * than crash.
 */

const twilio = require('twilio');

const isConfigured = Boolean(
  process.env.TWILIO_ACCOUNT_SID &&
  process.env.TWILIO_AUTH_TOKEN &&
  process.env.TWILIO_VERIFY_SERVICE_SID
);

const client = isConfigured
  ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  : null;

const verifyService = isConfigured
  ? client.verify.v2.services(process.env.TWILIO_VERIFY_SERVICE_SID)
  : null;

module.exports = { client, verifyService, isConfigured };
