'use strict';

const router = require('express').Router();
const { param, query: qv } = require('express-validator');

const { requireAuth, requireApproved } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { listDictionaryTerms, getDictionaryTerm } = require('../controllers/resourcesController');

// Educational content, same visibility as the rest of the authenticated app —
// still gated behind a real account, not made fully public, consistent with
// every other page here.
router.use(requireAuth, requireApproved);

router.get('/dictionary', [
  qv('q').optional().trim().isLength({ max: 100 }),
  qv('category').optional().trim().isLength({ max: 60 }),
], validate, listDictionaryTerms);

router.get('/dictionary/:slug', [
  param('slug').trim().isLength({ min: 1, max: 100 }),
], validate, getDictionaryTerm);

module.exports = router;
