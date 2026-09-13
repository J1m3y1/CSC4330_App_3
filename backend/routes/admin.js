'use strict';

const router = require('express').Router();
const { param, body, query: qv } = require('express-validator');

const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  listPending, approveUser, rejectUser, listReports, resolveReport,
  listPrivacyRequests, resolvePrivacyRequest,
  listMembershipRequests, resolveMembershipRequest,
} = require('../controllers/adminController');

// Every route here requires an authenticated admin. Deliberately does not
// require requireApproved — an admin's own approval state is irrelevant to
// whether they can moderate, and the bootstrap script always approves them
// anyway.
router.use(requireAuth, requireAdmin);

router.get('/pending', listPending);

router.post('/users/:id/approve', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, approveUser);

router.post('/users/:id/reject', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, rejectUser);

router.get('/reports', [
  qv('status').optional().isIn(['pending', 'reviewed', 'resolved', 'dismissed']),
], validate, listReports);

router.post('/reports/:id/resolve', [
  param('id').isUUID().withMessage('Invalid report ID.'),
  body('status').isIn(['resolved', 'dismissed']).withMessage('Status must be resolved or dismissed.'),
], validate, resolveReport);

router.get('/privacy-requests', [
  qv('status').optional().isIn(['pending', 'completed', 'dismissed']),
], validate, listPrivacyRequests);

router.post('/privacy-requests/:id/resolve', [
  param('id').isUUID().withMessage('Invalid request ID.'),
  body('status').isIn(['completed', 'dismissed']).withMessage('Status must be completed or dismissed.'),
], validate, resolvePrivacyRequest);

router.get('/membership-requests', [
  qv('status').optional().isIn(['pending', 'granted', 'declined']),
], validate, listMembershipRequests);

router.post('/membership-requests/:id/resolve', [
  param('id').isUUID().withMessage('Invalid request ID.'),
  body('status').isIn(['granted', 'declined']).withMessage('Status must be granted or declined.'),
], validate, resolveMembershipRequest);

module.exports = router;
