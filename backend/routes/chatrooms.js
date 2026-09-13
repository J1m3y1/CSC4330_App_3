'use strict';

const router = require('express').Router();
const { body, param, query: qv } = require('express-validator');

const { requireAuth, requireApproved, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  listRooms, getRoomMessages, postRoomMessage,
  deleteRoomMessage, createRoom, updateRoom,
} = require('../controllers/chatroomsController');

router.use(requireAuth, requireApproved);

// ── Member routes ─────────────────────────────────────────────────────────────

router.get('/', listRooms);

router.get('/:roomId/messages', [
  param('roomId').isUUID().withMessage('Invalid room ID.'),
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1 }).toInt(),
], validate, getRoomMessages);

router.post('/:roomId/messages', [
  param('roomId').isUUID().withMessage('Invalid room ID.'),
  body('body')
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Message must be between 1 and 1000 characters.'),
], validate, postRoomMessage);

router.delete('/:roomId/messages/:messageId', [
  param('roomId').isUUID().withMessage('Invalid room ID.'),
  param('messageId').isUUID().withMessage('Invalid message ID.'),
], validate, deleteRoomMessage);

// ── Admin-only routes ─────────────────────────────────────────────────────────

router.post('/', requireAdmin, [
  body('name')
    .trim()
    .isLength({ min: 2, max: 80 })
    .withMessage('Room name must be 2–80 characters.'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage('Description must be 300 characters or fewer.'),
  body('min_tier')
    .optional()
    .isIn(['free', 'silver', 'gold', 'black'])
    .withMessage('min_tier must be free, silver, gold, or black.'),
], validate, createRoom);

router.patch('/:roomId', requireAdmin, [
  param('roomId').isUUID().withMessage('Invalid room ID.'),
  body('name').optional().trim().isLength({ min: 2, max: 80 }),
  body('description').optional().trim().isLength({ max: 300 }),
  body('min_tier').optional().isIn(['free', 'silver', 'gold', 'black']),
  body('is_active').optional().isBoolean(),
], validate, updateRoom);

module.exports = router;
