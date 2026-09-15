'use strict';

const router = require('express').Router();
const { body, param, query: qv } = require('express-validator');

const { requireAuth, requireApproved, requireTier } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { US_STATES } = require('../config/usStates');
const {
  listEvents, getEvent, listEventAttendees, createEvent, updateEvent, deleteEvent, rsvpEvent, cancelRsvp,
} = require('../controllers/eventsController');

router.use(requireAuth, requireApproved);

router.get('/', [
  qv('state').optional().isIn(US_STATES),
  qv('group_id').optional().isUUID(),
  qv('date_from').optional().isISO8601(),
  qv('date_to').optional().isISO8601(),
  qv('q').optional().trim().isLength({ max: 100 }),
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
], validate, listEvents);

// Creating an event is a Gold+ perk, same precedent as Forum posting/Groups.
router.post('/', requireTier('gold'), [
  body('title').trim().isLength({ min: 2, max: 100 }).withMessage('Event title must be 2-100 characters.'),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 1500 }),
  body('location').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('state').optional({ checkFalsy: true }).isIn(US_STATES).withMessage('Invalid state.'),
  body('event_date').isISO8601().withMessage('A valid event date is required.'),
  body('event_end_date').optional({ checkFalsy: true }).isISO8601(),
  body('group_id').optional({ checkFalsy: true }).isUUID().withMessage('Invalid group.'),
], validate, createEvent);

router.get('/:id', [param('id').isUUID().withMessage('Invalid event ID.')], validate, getEvent);

router.get('/:id/attendees', [
  param('id').isUUID().withMessage('Invalid event ID.'),
  qv('status').optional().isIn(['interested', 'going']),
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
], validate, listEventAttendees);

router.patch('/:id', [
  param('id').isUUID().withMessage('Invalid event ID.'),
  body('title').optional().trim().isLength({ min: 2, max: 100 }),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 1500 }),
  body('location').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('state').optional({ checkFalsy: true }).isIn(US_STATES),
  body('event_date').optional().isISO8601(),
  body('event_end_date').optional({ checkFalsy: true }).isISO8601(),
], validate, updateEvent);

router.delete('/:id', [param('id').isUUID().withMessage('Invalid event ID.')], validate, deleteEvent);

router.post('/:id/rsvp', [
  param('id').isUUID().withMessage('Invalid event ID.'),
  body('status').isIn(['interested', 'going']).withMessage('Status must be interested or going.'),
], validate, rsvpEvent);

router.delete('/:id/rsvp', [param('id').isUUID().withMessage('Invalid event ID.')], validate, cancelRsvp);

module.exports = router;
