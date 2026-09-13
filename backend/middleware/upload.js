'use strict';

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads', 'avatars');

// Ensure upload directory exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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

module.exports = { avatarUpload, photoUpload };
