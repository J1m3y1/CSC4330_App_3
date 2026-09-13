'use strict';

const router = require('express').Router();
const { body } = require('express-validator');

const { requireAuth, requireApproved, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  getMembership, requestUpgrade, grantMembershipManually, cancelMembership, expireCheck,
} = require('../controllers/membershipController');

// All routes require auth + approval
router.use(requireAuth, requireApproved);

// ── Member routes ─────────────────────────────────────────────────────────────
router.get('/', getMembership);

router.post('/request', [
  body('tier')
    .isIn(['silver', 'gold', 'black'])
    .withMessage('Tier must be silver, gold, or black.'),
  body('note').optional().trim().isLength({ max: 1000 }),
], validate, requestUpgrade);

router.post('/cancel', cancelMembership);

// ── Admin-only routes ──────────────────────────────────────────────────────────
router.post('/grant', requireAdmin, [
  body('user_id').isUUID().withMessage('Invalid user ID.'),
  body('tier').isIn(['silver', 'gold', 'black']).withMessage('Tier must be silver, gold, or black.'),
], validate, grantMembershipManually);

router.post('/expire-check', requireAdmin, expireCheck);

module.exports = router;
