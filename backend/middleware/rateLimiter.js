'use strict';

const net = require('net');
const rateLimit = require('express-rate-limit');

// Azure App Service's proxy puts "ip:port" (not just the IP) in
// X-Forwarded-For for the client hop — e.g. "99.122.72.20:53906". express-
// rate-limit v7 validates the key it's given and throws
// (ERR_ERL_INVALID_IP_ADDRESS) rather than silently keying every request
// under a garbage bucket, which took down login/registration in production
// the moment real traffic hit it. Strip the port so each real client still
// gets one stable key — a raw ip:port string changes every request (new
// ephemeral port each time), which would otherwise make rate limiting a
// no-op even if it didn't crash.
function safeIpKey(req) {
  const ip = req.ip || '';
  if (net.isIP(ip)) return ip;
  const bracketed = ip.match(/^\[(.+)\]:\d+$/); // "[::1]:53906"
  if (bracketed && net.isIP(bracketed[1])) return bracketed[1];
  const lastColon = ip.lastIndexOf(':');
  if (lastColon > 0) {
    const stripped = ip.slice(0, lastColon); // "1.2.3.4:53906" -> "1.2.3.4"
    if (net.isIP(stripped)) return stripped;
  }
  return ip;
}

// Belt-and-suspenders: safeIpKey always returns a valid IP except in some
// pathological case we haven't seen, and disabling the library's own IP
// validation only means it trusts the key we give it — it doesn't skip
// normalizing that key, which safeIpKey above already does.
const KEY_OPTS = { keyGenerator: safeIpKey, validate: { ip: false } };

// ── General API limiter ─────────────────────────────────────────────────────
// 100 requests per 15 minutes per IP for all routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
  ...KEY_OPTS,
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
  ...KEY_OPTS,
});

// ── Password reset limiter ──────────────────────────────────────────────────
const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please try again in an hour.' },
  ...KEY_OPTS,
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
  ...KEY_OPTS,
});

// ── Veriff verification limiter ─────────────────────────────────────────────
// Public and pre-account like phoneLimiter above, but polling /session/:id
// status is expected, frequent, free-of-cost UX (not a paid SMS send), so
// this gets a more generous ceiling than phoneLimiter's 8.
const veriffLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification requests. Please wait a few minutes.' },
  ...KEY_OPTS,
});

module.exports = { apiLimiter, authLimiter, resetLimiter, phoneLimiter, veriffLimiter };
