'use strict';

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads', 'avatars');

// Government-ID scans are far more sensitive than a profile photo, so they
// live under a directory that is NEVER mounted by express.static (see
// server.js — only 'uploads/' is mounted, this is a sibling, not a child).
// The only way to read one back is the admin-only, auth-gated
// GET /api/admin/users/:id/id-document route.
const ID_UPLOAD_DIR = path.join(__dirname, '..', 'private-uploads', 'identity');
const VIDEO_UPLOAD_DIR = path.join(__dirname, '..', 'private-uploads', 'intro-videos');

// Ensure upload directories exist
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(ID_UPLOAD_DIR, { recursive: true });
fs.mkdirSync(VIDEO_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    // Random filename — never use user-supplied filename on disk
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(16).toString('hex');
    cb(null, `${name}${ext}`);
  },
});

function fileFilter(_req, file, cb) {
  // Accept only real image MIME types
  const allowed = ['image/jpeg', 'image/png', 'image/webp'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
  }
}

const MAX_MB = parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 5;

const multerOpts = {
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_MB * 1024 * 1024,
    files: 1,
  },
};

const uploadAvatar = multer(multerOpts).single('avatar');
const uploadPhoto  = multer(multerOpts).single('photo');

// ── Government ID (registration) ──────────────────────────────────────────────
const idStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, ID_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = crypto.randomBytes(16).toString('hex');
    cb(null, `${name}${ext}`);
  },
});

function idFileFilter(_req, file, cb) {
  const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('ID must be a JPEG, PNG, or PDF.'));
  }
}

const MAX_ID_MB = 10; // ID scans/PDFs run larger than a profile photo

const uploadId = multer({
  storage: idStorage,
  fileFilter: idFileFilter,
  limits: { fileSize: MAX_ID_MB * 1024 * 1024, files: 1 },
}).single('id_document');

// Wrap multer to return a proper JSON error instead of HTML
function avatarUpload(req, res, next) {
  uploadAvatar(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `Image must be under ${MAX_MB}MB.` });
    }
    return res.status(400).json({ error: err.message || 'Upload failed.' });
  });
}

function photoUpload(req, res, next) {
  uploadPhoto(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `Image must be under ${MAX_MB}MB.` });
    }
    return res.status(400).json({ error: err.message || 'Upload failed.' });
  });
}

function idUpload(req, res, next) {
  uploadId(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: `ID file must be under ${MAX_ID_MB}MB.` });
    }
    return res.status(400).json({ error: err.message || 'Upload failed.' });
  });
}

// Intro videos are private media: never place them under /uploads or return a
// public URL. The controller streams them only to Black members.
const videoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, VIDEO_UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
});
const MAX_VIDEO_MB = parseInt(process.env.MAX_INTRO_VIDEO_MB, 10) || 50;
const uploadVideo = multer({
  storage: videoStorage,
  fileFilter: (_req, file, cb) => {
    const allowed = ['video/mp4', 'video/webm', 'video/quicktime'];
    cb(allowed.includes(file.mimetype) ? null : new Error('Video must be an MP4, WebM, or MOV.'), allowed.includes(file.mimetype));
  },
  limits: { fileSize: MAX_VIDEO_MB * 1024 * 1024, files: 1 },
}).single('video');
function introVideoUpload(req, res, next) {
  uploadVideo(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `Video must be under ${MAX_VIDEO_MB}MB.` });
    return res.status(400).json({ error: err.message || 'Video upload failed.' });
  });
}

module.exports = { avatarUpload, photoUpload, idUpload, introVideoUpload, ID_UPLOAD_DIR, VIDEO_UPLOAD_DIR };
