'use strict';

const router = require('express').Router();
const { query: dbQuery } = require('express-validator');

const { requireAuth, requireApproved } = require('../middleware/auth');
const { validate }                     = require('../middleware/validate');
const { discoverMembers, searchMembers } = require('../controllers/discoverController');

router.use(requireAuth, requireApproved);

// ── GET /api/discover ─────────────────────────────────────────────────────────
router.get('/', [
  dbQuery('page').optional().isInt({ min: 1 }).toInt(),
  dbQuery('limit').optional().isInt({ min: 1 }).toInt(),
  dbQuery('tier').optional().isIn(['free', 'silver', 'gold', 'black']),
  dbQuery('location').optional().trim().isLength({ max: 100 }),
  dbQuery('interests').optional().trim().isLength({ max: 500 }),
  dbQuery('looking_for').optional().trim().isLength({ max: 500 }),
  dbQuery('education').optional().trim().isLength({ max: 60 }),
  dbQuery('relationship_status').optional().trim().isLength({ max: 60 }),
  dbQuery('smoking').optional().trim().isLength({ max: 30 }),
  dbQuery('q').optional().trim().isLength({ max: 100 }),
  dbQuery('sort').optional().isIn(['active', 'newest']),
], validate, discoverMembers);

// ── GET /api/discover/search ──────────────────────────────────────────────────
router.get('/search', [
  dbQuery('q').trim().isLength({ min: 2, max: 100 })
    .withMessage('Search query must be 2–100 characters.'),
  dbQuery('page').optional().isInt({ min: 1 }).toInt(),
  dbQuery('limit').optional().isInt({ min: 1 }).toInt(),
], validate, searchMembers);

module.exports = router;
