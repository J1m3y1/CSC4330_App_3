'use strict';

const router = require('express').Router();
const { body, param, query: qv } = require('express-validator');

const { requireAuth, requireApproved, requireTier } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  listFeed, createPost, deletePost, likePost, unlikePost,
  listComments, createComment, deleteComment,
  searchMentionCandidates, listNotifications, getUnreadCount, markNotificationsRead,
} = require('../controllers/forumController');

// Every route here requires an approved member — viewing the feed, liking,
// and commenting are open to any tier; only posting/reposting is Gold+.
router.use(requireAuth, requireApproved);

router.get('/posts', [
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
], validate, listFeed);

router.post('/posts', requireTier('gold'), [
  body('body').optional().trim().isLength({ max: 2000 }).withMessage('Posts must be 2000 characters or fewer.'),
  body('repost_of_id').optional().isUUID().withMessage('Invalid post ID.'),
  body('mentioned_user_ids').optional().isArray({ max: 20 }),
  body('mentioned_user_ids.*').optional().isUUID(),
], validate, createPost);

router.delete('/posts/:id', [
  param('id').isUUID().withMessage('Invalid post ID.'),
], validate, deletePost);

router.post('/posts/:id/like', [
  param('id').isUUID().withMessage('Invalid post ID.'),
], validate, likePost);

router.delete('/posts/:id/like', [
  param('id').isUUID().withMessage('Invalid post ID.'),
], validate, unlikePost);

router.get('/posts/:id/comments', [
  param('id').isUUID().withMessage('Invalid post ID.'),
], validate, listComments);

router.post('/posts/:id/comments', [
  param('id').isUUID().withMessage('Invalid post ID.'),
  body('body').trim().isLength({ min: 1, max: 1000 }).withMessage('Comment must be 1–1000 characters.'),
], validate, createComment);

router.delete('/comments/:id', [
  param('id').isUUID().withMessage('Invalid comment ID.'),
], validate, deleteComment);

router.get('/mention-candidates', [
  qv('q').optional().trim().isLength({ max: 50 }),
], validate, searchMentionCandidates);

router.get('/notifications', listNotifications);
router.get('/notifications/unread-count', getUnreadCount);
router.post('/notifications/read', markNotificationsRead);

module.exports = router;
