'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');

const { requireAuth, requireApproved } = require('../middleware/auth');
const { validate }                     = require('../middleware/validate');
const { avatarUpload, photoUpload }    = require('../middleware/upload');
const {
  getMyProfile, updateMyProfile, uploadAvatar,
  getProfile, blockUser, unblockUser, reportUser,
  createPrivacyRequest,
} = require('../controllers/profileController');
const {
  listMyPhotos, addPhoto, deletePhoto, setPrimaryPhoto, reorderPhotos,
} = require('../controllers/photosController');

// All profile routes require authentication + approval
router.use(requireAuth, requireApproved);

// ── Own profile ───────────────────────────────────────────────────────────────
router.get('/me', getMyProfile);

router.patch('/me', [
  body('display_name').optional().trim().isLength({ min: 2, max: 40 })
    .withMessage('Display name must be 2–40 characters.'),
  body('bio').optional().isLength({ max: 4000 })
    .withMessage('About you must be 4000 characters or fewer.'),
  body('location').optional().trim().isLength({ max: 100 }),
  body('interests').optional().isArray({ max: 20 })
    .withMessage('Interests must be an array of up to 20 items.'),
  body('interests.*').optional().trim().isLength({ min: 1, max: 50 }),
  body('show_location').optional().isBoolean(),
  body('show_last_active').optional().isBoolean(),
  body('allow_messages_from').optional()
    .isIn(['members', 'gold_plus', 'nobody'])
    .withMessage('Invalid messages permission value.'),
  // ── Profile-setup fields ──────────────────────────────────────────────────
  body('heading').optional().trim().isLength({ max: 50 })
    .withMessage('Heading must be 50 characters or fewer.'),
  body('looking_for').optional().isArray({ max: 7 })
    .withMessage('Looking-for must be an array of up to 7 items.'),
  body('looking_for.*').optional().trim().isLength({ min: 1, max: 50 }),
  body('weight_label').optional().trim().isLength({ max: 30 }),
  body('weight_unit').optional().isIn(['lbs', 'kg']),
  body('weight_visible').optional().isBoolean(),
  body('height_label').optional().trim().isLength({ max: 30 }),
  body('height_unit').optional().isIn(['ft', 'cm']),
  body('education').optional().trim().isLength({ max: 60 }),
  body('relationship_status').optional().trim().isLength({ max: 60 }),
  body('smoking').optional().trim().isLength({ max: 30 }),
], validate, updateMyProfile);

router.post('/avatar', avatarUpload, uploadAvatar);

router.post('/privacy-requests', [
  body('type')
    .isIn(['access', 'correct', 'restrict', 'object', 'portability', 'delete'])
    .withMessage('Invalid request type.'),
  body('reason').optional().trim().isLength({ max: 1000 }),
], validate, createPrivacyRequest);

// ── Photo gallery ───────────────────────────────────────────────────────────────
// Registered before the /:id catch-all below — otherwise Express would match
// "/photos" as :id = "photos".
router.get('/photos', listMyPhotos);
router.post('/photos', photoUpload, addPhoto);
router.patch('/photos/reorder', [
  body('photo_ids').isArray({ min: 1 }).withMessage('photo_ids must be a non-empty array.'),
  body('photo_ids.*').isUUID().withMessage('Invalid photo ID.'),
], validate, reorderPhotos);
router.delete('/photos/:photoId', [
  param('photoId').isUUID().withMessage('Invalid photo ID.'),
], validate, deletePhoto);
router.patch('/photos/:photoId/primary', [
  param('photoId').isUUID().withMessage('Invalid photo ID.'),
], validate, setPrimaryPhoto);

// ── Other members' profiles ───────────────────────────────────────────────────
router.get('/:id', [
  param('id').isUUID().withMessage('Invalid profile ID.'),
], validate, getProfile);

router.post('/:id/block', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, blockUser);

router.delete('/:id/block', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, unblockUser);

router.post('/:id/report', [
  param('id').isUUID().withMessage('Invalid user ID.'),
  body('reason').trim().isLength({ min: 10, max: 1000 })
    .withMessage('Please provide a reason between 10 and 1000 characters.'),
], validate, reportUser);

module.exports = router;
