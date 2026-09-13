'use strict';

const router = require('express').Router();
const { body, param, query: qv } = require('express-validator');

const { requireAuth, requireApproved } = require('../middleware/auth');
const { validate }                     = require('../middleware/validate');
const {
  getConversations, getThread, sendMessage, deleteMessage,
} = require('../controllers/messagesController');

router.use(requireAuth, requireApproved);

// ── GET /api/messages/conversations ──────────────────────────────────────────
router.get('/conversations', getConversations);

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
