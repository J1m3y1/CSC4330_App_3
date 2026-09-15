'use strict';

const router = require('express').Router();
const { query: qv } = require('express-validator');

const { requireAuth, requireApproved } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { search, typeahead } = require('../controllers/searchController');

router.use(requireAuth, requireApproved);

const CATEGORIES = ['members', 'groups', 'events', 'posts', 'resources'];

router.get('/', [
  qv('q').trim().isLength({ min: 2, max: 100 }).withMessage('Search must be at least 2 characters.'),
  qv('category').optional().isIn(CATEGORIES).withMessage('Invalid category.'),
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
], validate, search);

router.get('/typeahead', [
  qv('q').trim().isLength({ min: 2, max: 100 }).withMessage('Search must be at least 2 characters.'),
], validate, typeahead);

module.exports = router;
