'use strict';

const router = require('express').Router();
const { param, body, query: qv } = require('express-validator');

const { requireAuth, requireAdmin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const {
  listPending, approveUser, rejectUser, getIdentityDocument, listReports, resolveReport,
  listPrivacyRequests, resolvePrivacyRequest,
  listMembershipRequests, resolveMembershipRequest,
  listPhotoVerifications, getPhotoVerificationSelfie, resolvePhotoVerification,
  listUsers, suspendUser, reactivateUser, updateUserRole,
  getStats, listAllChatrooms,
  listDictionaryTermsAdmin, createDictionaryTerm, updateDictionaryTerm, deleteDictionaryTerm,
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

router.get('/users/:id/id-document', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, getIdentityDocument);

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

router.get('/photo-verifications', [
  qv('status').optional().isIn(['pending', 'approved', 'rejected']),
], validate, listPhotoVerifications);

router.get('/photo-verifications/:id/selfie', [
  param('id').isUUID().withMessage('Invalid request ID.'),
], validate, getPhotoVerificationSelfie);

router.post('/photo-verifications/:id/resolve', [
  param('id').isUUID().withMessage('Invalid request ID.'),
  body('status').isIn(['approved', 'rejected']).withMessage('Status must be approved or rejected.'),
], validate, resolvePhotoVerification);

router.get('/stats', getStats);

router.get('/chatrooms', listAllChatrooms);

// ── Dictionary terms (admin-authored, no review queue) ─────────────────────────
router.get('/dictionary-terms', listDictionaryTermsAdmin);
router.post('/dictionary-terms', [
  body('term').trim().isLength({ min: 1, max: 80 }).withMessage('Term is required.'),
  body('definition').trim().isLength({ min: 1, max: 2000 }).withMessage('Definition is required.'),
  body('category').optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
], validate, createDictionaryTerm);
router.patch('/dictionary-terms/:id', [
  param('id').isUUID().withMessage('Invalid term ID.'),
  body('term').optional().trim().isLength({ min: 1, max: 80 }),
  body('definition').optional().trim().isLength({ min: 1, max: 2000 }),
  body('category').optional({ checkFalsy: true }).trim().isLength({ max: 60 }),
], validate, updateDictionaryTerm);
router.delete('/dictionary-terms/:id', [
  param('id').isUUID().withMessage('Invalid term ID.'),
], validate, deleteDictionaryTerm);

router.get('/users', [
  qv('role').optional().isIn(['member', 'admin']),
  qv('tier').optional().isIn(['free', 'silver', 'gold', 'black']),
  qv('status').optional().isIn(['pending', 'active', 'suspended', 'rejected']),
  qv('page').optional().isInt({ min: 1 }).toInt(),
  qv('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
], validate, listUsers);

router.post('/users/:id/suspend', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, suspendUser);

router.post('/users/:id/reactivate', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, reactivateUser);

router.patch('/users/:id/role', [
  param('id').isUUID().withMessage('Invalid user ID.'),
  body('role').isIn(['member', 'admin']).withMessage('Role must be member or admin.'),
], validate, updateUserRole);

module.exports = router;
