'use strict';

const router = require('express').Router();
const { body } = require('express-validator');

const { authLimiter, resetLimiter } = require('../middleware/rateLimiter');
const { validate }                  = require('../middleware/validate');
const { requireAuth }               = require('../middleware/auth');
const { idUpload }                  = require('../middleware/upload');
const {
  register, login, refresh, logout,
  forgotPassword, resetPassword, changePassword, me,
} = require('../controllers/authController');

// ── Validation chains ─────────────────────────────────────────────────────────

const registerRules = [
  body('email')
    .isEmail().withMessage('A valid email is required.')
    .normalizeEmail(),
  body('password')
    .isLength({ min: 10 }).withMessage('Password must be at least 10 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.')
    .matches(/[^A-Za-z0-9]/).withMessage('Password must contain at least one special character.'),
  body('display_name')
    .trim()
    .isLength({ min: 2, max: 40 }).withMessage('Display name must be 2–40 characters.'),
  body('date_of_birth')
    .isISO8601().withMessage('A valid date of birth is required.')
    .toDate(),
  body('phone')
    .optional().trim()
    .matches(/^\+?[1-9]\d{7,14}$/).withMessage('Enter a valid phone number.'),
  body('phone_verification_token')
    .if(body('phone').exists({ checkFalsy: true }))
    .notEmpty().withMessage('Phone verification is required — please verify your number again.'),
];

const loginRules = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

const forgotRules = [
  body('email').isEmail().withMessage('A valid email is required.').normalizeEmail(),
];

const resetRules = [
  body('token').notEmpty().withMessage('Reset token is required.'),
  body('password')
    .isLength({ min: 10 }).withMessage('Password must be at least 10 characters.')
    .matches(/[A-Z]/).withMessage('Password must contain at least one uppercase letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.')
    .matches(/[^A-Za-z0-9]/).withMessage('Password must contain at least one special character.'),
];

const changePasswordRules = [
  body('current_password').notEmpty().withMessage('Current password is required.'),
  body('new_password')
    .isLength({ min: 10 }).withMessage('New password must be at least 10 characters.')
    .matches(/[A-Z]/).withMessage('New password must contain at least one uppercase letter.')
    .matches(/[0-9]/).withMessage('New password must contain at least one number.')
    .matches(/[^A-Za-z0-9]/).withMessage('New password must contain at least one special character.'),
];

// ── Routes ────────────────────────────────────────────────────────────────────

// Public — rate limited
// idUpload runs first so multer parses the multipart body into req.body
// (text fields) and req.file (the ID scan) before express-validator's body()
// checks run against it.
router.post('/register',        authLimiter,  idUpload, registerRules, validate, register);
router.post('/login',           authLimiter,  loginRules,    validate, login);
router.post('/forgot-password', resetLimiter, forgotRules,   validate, forgotPassword);
router.post('/reset-password',  resetLimiter, resetRules,    validate, resetPassword);

// Requires valid refresh token cookie
router.post('/refresh', refresh);

// Requires valid access token cookie
router.post('/logout', requireAuth, logout);
router.get('/me',      requireAuth, me);
router.post('/change-password', requireAuth, changePasswordRules, validate, changePassword);

module.exports = router;
