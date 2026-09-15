'use strict';

const router = require('express').Router();
const { body, param, query: qv } = require('express-validator');

const { requireAuth, requireApproved, requireTier } = require('../middleware/auth');
const { validate }                     = require('../middleware/validate');
const {
  getConversations, getThread, sendMessage, deleteMessage,
  getConversationSettings, setConversationSettings,
  getMessageRequests, acceptMessageRequest, declineMessageRequest,
  archiveConversation, unarchiveConversation, getUnreadCount,
} = require('../controllers/messagesController');

router.use(requireAuth, requireApproved);

// ── GET /api/messages/conversations ──────────────────────────────────────────
router.get('/conversations', [
  qv('view').optional().isIn(['inbox', 'archived']),
], validate, getConversations);

// ── Message Requests + unread counts — registered before the /:partnerId
// catch-alls for the same reason as every other literal-segment route below.
router.get('/requests', getMessageRequests);
router.get('/unread-count', getUnreadCount);
router.post('/:partnerId/accept-request', [
  param('partnerId').isUUID().withMessage('Invalid partner ID.'),
], validate, acceptMessageRequest);
router.post('/:partnerId/decline-request', [
  param('partnerId').isUUID().withMessage('Invalid partner ID.'),
], validate, declineMessageRequest);
router.post('/:partnerId/archive', [
  param('partnerId').isUUID().withMessage('Invalid partner ID.'),
], validate, archiveConversation);
router.delete('/:partnerId/archive', [
  param('partnerId').isUUID().withMessage('Invalid partner ID.'),
], validate, unarchiveConversation);

// ── Disappearing messages (Black tier to change; either side can view) ───────
// Registered before the /:partnerId catch-alls for the same reason as the
// other literal-segment routes elsewhere in this codebase.
router.get('/:partnerId/settings', [
  param('partnerId').isUUID().withMessage('Invalid partner ID.'),
], validate, getConversationSettings);
router.put('/:partnerId/settings', requireTier('black'), [
  param('partnerId').isUUID().withMessage('Invalid partner ID.'),
  body('disappearing_seconds')
    .custom((v) => v === null || [300, 3600, 86400, 604800].includes(v))
    .withMessage('disappearing_seconds must be null or one of 300, 3600, 86400, 604800.'),
], validate, setConversationSettings);

// ── GET /api/messages/:partnerId ─────────────────────────────────────────────
router.get('/:partnerId', [
  param('partnerId').isUUID().withMessage('Invalid partner ID.'),
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1 }).toInt(),
], validate, getThread);

// ── POST /api/messages/:partnerId ────────────────────────────────────────────
router.post('/:partnerId', [
  param('partnerId').isUUID().withMessage('Invalid partner ID.'),
  body('body')
    .trim()
    .isLength({ min: 1, max: 2000 })
    .withMessage('Message must be between 1 and 2000 characters.'),
], validate, sendMessage);

// ── DELETE /api/messages/:messageId ──────────────────────────────────────────
router.delete('/:messageId', [
  param('messageId').isUUID().withMessage('Invalid message ID.'),
], validate, deleteMessage);

module.exports = router;
