'use strict';

const router = require('express').Router();
const { body, param } = require('express-validator');

const { requireAuth, requireApproved, requireTier } = require('../middleware/auth');
const { validate }                     = require('../middleware/validate');
const { avatarUpload, photoUpload, introVideoUpload } = require('../middleware/upload');
const {
  getMyProfile, updateMyProfile, uploadAvatar, uploadIntroVideo, deleteIntroVideo, streamIntroVideo,
  getProfile, blockUser, unblockUser, reportUser, listBlocked,
  requestPhotoAccess, listPhotoRequests, respondPhotoRequest,
  requestProfileViewAccess, listProfileViewRequests, respondProfileViewRequest,
  getProfileNote, saveProfileNote, deleteProfileNote,
  getBoostStatus, activateBoost,
  createPrivacyRequest,
  getMyInterestTags, setMyInterestTags,
  listGeofences, addGeofence, deleteGeofence,
} = require('../controllers/profileController');
const { INTEREST_LEVELS } = require('../config/interestTags');
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
  body('blur_photos').optional().isBoolean(),
  body('incognito').optional().isBoolean(),
  body('black_only_visibility').optional().isBoolean(),
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

// Gold/Black can upload a private introduction; only Black can stream one.
router.post('/intro-video', requireTier('gold'), introVideoUpload, uploadIntroVideo);
router.delete('/intro-video', requireTier('gold'), deleteIntroVideo);

router.post('/privacy-requests', [
  body('type')
    .isIn(['access', 'correct', 'restrict', 'object', 'portability', 'delete'])
    .withMessage('Invalid request type.'),
  body('reason').optional().trim().isLength({ max: 1000 }),
], validate, createPrivacyRequest);

// ── Interest tags (rated, with Gold+/Black custom tags) ──────────────────────────
// Registered before the /:id catch-all for the same reason as the photo
// routes below.
router.get('/interest-tags', getMyInterestTags);
router.put('/interest-tags', [
  body('interests').isArray({ max: 20 }).withMessage('Interests must be an array of up to 20 tags.'),
  body('interests.*.tag').trim().isLength({ min: 1, max: 50 }).withMessage('Each tag must be 1–50 characters.'),
  body('interests.*.level').isIn(INTEREST_LEVELS).withMessage(`Level must be one of: ${INTEREST_LEVELS.join(', ')}.`),
  body('interests.*.is_custom').optional().isBoolean(),
], validate, setMyInterestTags);

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

// ── Blocked members list ──────────────────────────────────────────────────────
// Registered before the /:id catch-all for the same reason as the photo and
// interest-tag routes above.
router.get('/blocked', listBlocked);

// ── Boost (open to every tier, rationed by a 24h cooldown instead of money —
// no payment processor exists to gate it behind) ─────────────────────────────
router.get('/boost', getBoostStatus);
router.post('/boost', activateBoost);

// ── Photo access requests (blurred-photo mode) ────────────────────────────────
// Also registered before /:id.
router.get('/photo-requests', listPhotoRequests);
router.post('/photo-requests/:viewerId/respond', [
  param('viewerId').isUUID().withMessage('Invalid user ID.'),
  body('status').isIn(['approved', 'denied']).withMessage('Status must be approved or denied.'),
], validate, respondPhotoRequest);

// ── Profile view requests (Black-only visibility escalation) ─────────────────
// Also registered before /:id.
router.get('/view-requests', listProfileViewRequests);
router.post('/view-requests/:requesterId/respond', [
  param('requesterId').isUUID().withMessage('Invalid user ID.'),
  body('status').isIn(['approved', 'denied']).withMessage('Status must be approved or denied.'),
], validate, respondProfileViewRequest);

// ── Geofenced privacy (Black tier only) ───────────────────────────────────────
// Registered before the /:id catch-all for the same reason as the other
// literal-segment routes above.
router.get('/geofences', requireTier('black'), listGeofences);
router.post('/geofences', requireTier('black'), [
  body('label').trim().isLength({ min: 1, max: 40 }).withMessage('Label must be 1–40 characters.'),
  body('address').trim().isLength({ min: 3, max: 200 }).withMessage('Address must be 3–200 characters.'),
  body('radius_miles').isFloat({ min: 0.5, max: 100 }).withMessage('Radius must be between 0.5 and 100 miles.'),
], validate, addGeofence);
router.delete('/geofences/:geofenceId', requireTier('black'), [
  param('geofenceId').isInt().withMessage('Invalid zone ID.'),
], validate, deleteGeofence);

router.get('/:id/intro-video', requireTier('black'), [
  param('id').isUUID().withMessage('Invalid profile ID.'),
], validate, streamIntroVideo);

// ── Other members' profiles ───────────────────────────────────────────────────
router.get('/:id', [
  param('id').isUUID().withMessage('Invalid profile ID.'),
], validate, getProfile);

router.post('/:id/block', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, blockUser);

router.post('/:id/photo-request', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, requestPhotoAccess);

router.post('/:id/view-request', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, requestProfileViewAccess);

// ── Private notes (Gold+) ─────────────────────────────────────────────────────
// Enforced here via requireTier, not just hidden client-side — same pattern
// as custom interest tags and forum posting.
router.get('/:id/note', requireTier('gold'), [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, getProfileNote);
router.put('/:id/note', requireTier('gold'), [
  param('id').isUUID().withMessage('Invalid user ID.'),
  body('body').trim().isLength({ min: 1, max: 2000 }).withMessage('Note must be 1–2000 characters.'),
], validate, saveProfileNote);
router.delete('/:id/note', requireTier('gold'), [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, deleteProfileNote);

router.delete('/:id/block', [
  param('id').isUUID().withMessage('Invalid user ID.'),
], validate, unblockUser);

router.post('/:id/report', [
  param('id').isUUID().withMessage('Invalid user ID.'),
  body('reason').trim().isLength({ min: 10, max: 1000 })
    .withMessage('Please provide a reason between 10 and 1000 characters.'),
], validate, reportUser);

module.exports = router;
