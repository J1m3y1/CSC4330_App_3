'use strict';

const router = require('express').Router();
const { body, param, query: qv } = require('express-validator');

const { requireAuth, requireApproved, requireTier } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { US_STATES } = require('../config/usStates');
const { CATEGORIES } = require('../config/groupOptions');
const {
  listGroups, getGroup, listGroupMembers, createGroup, updateGroup, deleteGroup, joinGroup, leaveGroup,
} = require('../controllers/groupsController');

router.use(requireAuth, requireApproved);

router.get('/', [
  qv('state').optional().isIn(US_STATES),
  qv('category').optional().isIn(CATEGORIES),
  qv('q').optional().trim().isLength({ max: 100 }),
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
], validate, listGroups);

// Creating a group is a Gold+ perk, same precedent as Forum posting.
router.post('/', requireTier('gold'), [
  body('name').trim().isLength({ min: 2, max: 80 }).withMessage('Group name must be 2-80 characters.'),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  body('category').optional({ checkFalsy: true }).isIn(CATEGORIES).withMessage('Invalid category.'),
  body('location').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('state').optional({ checkFalsy: true }).isIn(US_STATES).withMessage('Invalid state.'),
], validate, createGroup);

router.get('/:id', [param('id').isUUID().withMessage('Invalid group ID.')], validate, getGroup);

router.get('/:id/members', [
  param('id').isUUID().withMessage('Invalid group ID.'),
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1, max: 50 }).toInt(),
], validate, listGroupMembers);

router.patch('/:id', [
  param('id').isUUID().withMessage('Invalid group ID.'),
  body('name').optional().trim().isLength({ min: 2, max: 80 }),
  body('description').optional({ checkFalsy: true }).trim().isLength({ max: 1000 }),
  body('category').optional({ checkFalsy: true }).isIn(CATEGORIES),
  body('location').optional({ checkFalsy: true }).trim().isLength({ max: 100 }),
  body('state').optional({ checkFalsy: true }).isIn(US_STATES),
], validate, updateGroup);

router.delete('/:id', [param('id').isUUID().withMessage('Invalid group ID.')], validate, deleteGroup);

router.post('/:id/join',  [param('id').isUUID().withMessage('Invalid group ID.')], validate, joinGroup);
router.post('/:id/leave', [param('id').isUUID().withMessage('Invalid group ID.')], validate, leaveGroup);

module.exports = router;
