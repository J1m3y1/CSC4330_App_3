'use strict';

const router = require('express').Router();
const { param } = require('express-validator');

const { requireAuth, requireApproved } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  likeUser, unlikeUser, listLiked, listLikedMe, listViewedMe,
} = require('../controllers/interestsController');

router.use(requireAuth, requireApproved);

router.get('/liked',       listLiked);
router.get('/liked-me',    listLikedMe);
router.get('/viewed-me',   listViewedMe);

router.post('/likes/:id', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, likeUser);

router.delete('/likes/:id', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, unlikeUser);

module.exports = router;
