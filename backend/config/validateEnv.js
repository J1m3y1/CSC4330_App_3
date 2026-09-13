'use strict';

/**
 * Fails fast and loudly if required configuration is missing, instead of
 * booting "successfully" and then throwing on the first request that needs
 * the missing value (e.g. JWT_SECRET undefined → jwt.sign throws on first
 * login, surfaced to the client as an opaque 500).
 */
function validateEnv() {
  const required = [
    'DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD',
    'JWT_SECRET', 'REFRESH_TOKEN_SECRET',
  ];

  const missing = required.filter(key => !process.env[key] || !process.env[key].trim());
  if (missing.length) {
    console.error(`[fantasi] Missing required environment variable(s): ${missing.join(', ')}`);
    console.error('[fantasi] Copy backend/.env.example to backend/.env and fill these in.');
    process.exit(1);
  }

  if (process.env.JWT_SECRET.length < 32) {
    console.error('[fantasi] JWT_SECRET is too short (< 32 chars). Generate one with:');
    console.error(`[fantasi]   node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`);
    process.exit(1);
  }
  if (process.env.REFRESH_TOKEN_SECRET.length < 32) {
    console.error('[fantasi] REFRESH_TOKEN_SECRET is too short (< 32 chars).');
    process.exit(1);
  }
  if (process.env.JWT_SECRET === process.env.REFRESH_TOKEN_SECRET) {
    console.error('[fantasi] JWT_SECRET and REFRESH_TOKEN_SECRET must be different values.');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ALLOWED_ORIGINS || !process.env.ALLOWED_ORIGINS.trim()) {
      console.error('[fantasi] ALLOWED_ORIGINS must be set in production.');
      process.exit(1);
    }
  }

  // Optional integrations — warn rather than exit, since the app should
  // still run without them (mail routes degrade gracefully).
  if (!process.env.SMTP_HOST) {
    console.warn('[fantasi] SMTP_HOST not set — password reset emails will only be logged, not sent.');
  }
}

module.exports = { validateEnv };
