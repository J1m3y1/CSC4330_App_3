'use strict';

const rateLimit = require('express-rate-limit');

// ── General API limiter ─────────────────────────────────────────────────────
// 100 requests per 15 minutes per IP for all routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});

// ── Auth limiter ────────────────────────────────────────────────────────────
// Strict limit on login/register/reset to slow brute-force attacks
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts. Please wait 15 minutes.' },
  skipSuccessfulRequests: true, // Only counts failed/errored attempts
});

// ── Password reset limiter ──────────────────────────────────────────────────
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again in an hour.' },
});

// ── Phone verification limiter ───────────────────────────────────────────────
// These endpoints are public (no session exists yet during signup) and each
// send-code call costs real money via Twilio, so they get their own strict,
// per-IP limit distinct from the general API limiter.
const phoneLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please wait 15 minutes.' },
});

module.exports = { apiLimiter, authLimiter, resetLimiter, phoneLimiter };
