'use strict';

const router = require('express').Router();
const { param } = require('express-validator');
const { requireAuth, requireApproved, requireTier } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { discoverMembers, searchMembers } = require('../controllers/discoverController');
const { filterOptions, listSavedSearches, createSavedSearch, deleteSavedSearch } = require('../controllers/savedSearchController');

router.use(requireAuth, requireApproved);
router.get('/filter-options', filterOptions);
router.get('/saved', requireTier('black'), listSavedSearches);
router.post('/saved', requireTier('black'), createSavedSearch);
router.delete('/saved/:id', requireTier('black'), [param('id').isUUID()], validate, deleteSavedSearch);
// Both entry points share filter validation and membership enforcement.
router.get('/', discoverMembers);
router.get('/search', searchMembers);

module.exports = router;
