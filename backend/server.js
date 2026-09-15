'use strict';

require('dotenv').config();

const { validateEnv } = require('./config/validateEnv');
validateEnv(); // fail fast on missing/weak secrets — see H5 in the audit

const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const cookieParser = require('cookie-parser');
const path       = require('path');

const { apiLimiter } = require('./middleware/rateLimiter');

// ── Route imports ────────────────────────────────────────────────────────────
const authRoutes       = require('./routes/auth');
const profileRoutes    = require('./routes/profile');
const membershipRoutes = require('./routes/membership');
const discoverRoutes   = require('./routes/discover');
const messagesRoutes   = require('./routes/messages');
const chatroomsRoutes  = require('./routes/chatrooms');
const adminRoutes      = require('./routes/admin');
const interestsRoutes  = require('./routes/interests');
const phoneRoutes      = require('./routes/phone');
const forumRoutes      = require('./routes/forum');
const veriffRoutes     = require('./routes/veriff');
const { purgeExpiredMessages } = require('./controllers/messagesController');

const app  = express();
const PORT = process.env.PORT || 5000;
const FRONTEND_ROOT = path.join(__dirname, '..');

// Azure App Service terminates requests behind its reverse proxy. Trust its
// first forwarded hop so req.ip and express-rate-limit see the client IP.
app.set('trust proxy', 1);

// ── Security headers (Helmet) ────────────────────────────────────────────────
// scriptSrc/styleSrc allow 'unsafe-inline': every page here is static HTML
// with inline <script>/<style> blocks (no build step, no per-request
// templating), so a strict CSP would silently break every button and
// animation on the site the moment it's served through this app. A stricter
// nonce-based CSP is possible but needs each page rendered through a route
// handler rather than served as a static file — worth doing if this
// frontend ever moves off plain static HTML.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'", 'https://use.typekit.net', 'https://p.typekit.net'],
      fontSrc:     ["'self'", 'https://use.typekit.net', 'https://p.typekit.net'],
      imgSrc:      ["'self'", 'data:'],
      mediaSrc:    ["'self'"],
      // https://nominatim.openstreetmap.org: SignUp.html's "Use my location"
      // reverse-geocodes the browser's coordinates against Nominatim's free
      // API directly from the client — without this, every attempt asks for
      // location permission, succeeds, then silently fails the geocode
      // fetch with a CSP violation, landing on "We could not match your
      // location" no matter what coordinates come back.
      connectSrc:  ["'self'", 'https://nominatim.openstreetmap.org'],
      frameSrc:    ["'none'"],
      objectSrc:   ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
// The app's own origin (APP_URL) is always allowed — the frontend is served
// same-origin by this same server (see FRONTEND_DIRS below), and a same-origin
// fetch still carries an Origin header the cors package checks, so leaving it
// out here would lock the app out of its own API. ALLOWED_ORIGINS is for any
// *additional*, genuinely cross-origin caller (a separate marketing site, a
// mobile app's dev server, etc).
const allowedOrigins = [
  process.env.APP_URL,
  ...(process.env.ALLOWED_ORIGINS || '').split(','),
]
  .map(o => (o || '').trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman in dev)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true, // Required for httpOnly cookie auth
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With'],
}));

// ── Body parsing ─────────────────────────────────────────────────────────────
// The `verify` callback stashes the exact raw bytes on req.rawBody — needed
// by POST /api/veriff/webhook, which must verify Veriff's HMAC signature
// against the literal request body it sent, not a re-serialization of the
// parsed object (which can differ in key order/whitespace and would always
// fail the signature check). Cheap for every other route: just a Buffer
// reference to bytes already read off the wire, not a second parse.
app.use(express.json({
  limit: '50kb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));
app.use(cookieParser());

// ── Static files ─────────────────────────────────────────────────────────────
// Shared JS client — served under /js
app.use('/js', express.static(path.join(__dirname, 'public/js'), {
  dotfiles: 'deny',
  index: false,
}));

// Uploads (avatars etc.) — served under /uploads; never execute files here
app.use('/uploads', express.static(path.join(__dirname, process.env.UPLOAD_DIR || 'uploads'), {
  dotfiles: 'deny',
  index: false,
}));

// Frontend — served same-origin so the app works anywhere it's deployed
// without hardcoding a dev origin into every page, and so the httpOnly,
// SameSite=strict auth cookies (which never cross origins) actually reach
// the API. Each folder is mounted individually rather than the whole repo
// root, which would otherwise also serve backend/.env and source over HTTP.
const FRONTEND_DIRS = ['LandingPage', 'Dashboard', 'Profile', 'SignInProcess', 'SignUpProcess', 'AdminPage'];
for (const dir of FRONTEND_DIRS) {
  app.use(`/${dir}`, express.static(path.join(FRONTEND_ROOT, dir), {
    dotfiles: 'deny',
    index: false,
  }));
}
app.get('/manifest.json', (_req, res) => res.sendFile(path.join(FRONTEND_ROOT, 'manifest.json')));
// Browsers request this by default with no <link rel="icon"> anywhere in the
// markup to opt out of — serving the existing logo here avoids a 404 on
// every single page load instead of adding an icon link to every page.
app.get('/favicon.ico', (_req, res) => res.sendFile(path.join(FRONTEND_ROOT, 'LandingPage/videos/fantasi-logo-gold.png')));
app.get('/sw.js', (_req, res) => res.type('application/javascript').sendFile(path.join(FRONTEND_ROOT, 'sw.js')));
app.get('/', (_req, res) => res.redirect('/LandingPage/Landing.html'));

// ── Global rate limiter ───────────────────────────────────────────────────────
app.use('/api', apiLimiter);

// ── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/auth',       authRoutes);
app.use('/api/profile',    profileRoutes);
app.use('/api/membership', membershipRoutes);
app.use('/api/discover',   discoverRoutes);
app.use('/api/messages',   messagesRoutes);
app.use('/api/chatrooms',  chatroomsRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/interests',  interestsRoutes);
app.use('/api/phone',      phoneRoutes);
app.use('/api/forum',      forumRoutes);
app.use('/api/veriff',     veriffRoutes);

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found.' }));

// ── Global error handler ─────────────────────────────────────────────────────
// Never leak stack traces to the client
app.use((err, _req, res, _next) => {
  console.error('[server error]', err.message);
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred.'
    : err.message;
  res.status(status).json({ error: message });
});

// ── Start ─────────────────────────────────────────────────────────────────────
// Guarded so `require('./server')` (the test suite does this) gets the app
// without also binding PORT — the test starts its own listener on an
// ephemeral port instead.
function start() {
  app.listen(PORT, () => {
    console.log(`[fantasi] API running on http://localhost:${PORT}`);
    console.log(`[fantasi] Environment: ${process.env.NODE_ENV}`);
  });

  // Disappearing messages also get swept lazily on every conversation/thread
  // read, but a member with a conversation open and nobody reloading it
  // should still see messages actually vanish close to on schedule.
  setInterval(() => {
    purgeExpiredMessages().catch((err) => console.error('[purgeExpiredMessages]', err.message));
  }, 60_000);
}

if (require.main === module) start();

module.exports = app;
module.exports.start = start;
