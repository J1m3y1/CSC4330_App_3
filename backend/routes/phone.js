'use strict';

const router = require('express').Router();
const { body } = require('express-validator');

const { phoneLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/validate');
const { sendCode, verifyCode } = require('../controllers/phoneController');

// Public — no session exists yet at this point in the sign-up wizard.
// Rate-limited hard: each send-code call costs real money via Twilio.

const phoneRule = body('phone')
  .trim()
  .matches(/^\+?[1-9]\d{7,14}$/)
  .withMessage('Enter a valid phone number, e.g. +15551234567.');

router.post('/send-code', phoneLimiter, [
  phoneRule,
], validate, sendCode);

router.post('/verify-code', phoneLimiter, [
  phoneRule,
  body('code').trim().isLength({ min: 4, max: 8 }).withMessage('Enter the code you received.'),
], validate, verifyCode);

module.exports = router;
