'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');

const { veriffLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { createSession, getStatus, webhook } = require('../controllers/veriffController');

// Public — no session exists yet at this point in the sign-up wizard.
router.post('/create-session', veriffLimiter, [
  body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
  body('full_name').trim().isLength({ min: 1, max: 120 }).withMessage('Full name is required.'),
], validate, createSession);

router.get('/session/:id/status', veriffLimiter, [
  param('id').isUUID().withMessage('Invalid session ID.'),
], validate, getStatus);

// Called by Veriff's own servers, never a browser — no rate limiter (that
// would let a burst of legitimate decisions from Veriff get throttled) and
// no CORS/session applies. Authenticity comes from the HMAC signature
// checked inside the controller instead.
router.post('/webhook', webhook);

module.exports = router;
