'use strict';

const path = require('path');
const fs   = require('fs');
const { query, withTransaction } = require('../config/db');

const MAX_PHOTOS = 6; // matches the six slots in Dashboard/profile-setup.html

/**
 * Keeps profiles.avatar_url (the fast, denormalized "primary photo" every
 * other query reads) in sync with whichever photo is actually marked
 * primary in the gallery — or clears it if the gallery is now empty.
 */
async function syncAvatarUrl(client, userId) {
  const { rows } = await client.query(
    `SELECT url FROM profile_photos WHERE user_id = $1 AND is_primary = TRUE`,
    [userId]
  );
  await client.query(
    'UPDATE profiles SET avatar_url = $1, updated_at = NOW() WHERE user_id = $2',
    [rows[0]?.url || null, userId]
  );
}

// ── GET /api/profile/photos ────────────────────────────────────────────────────
async function listMyPhotos(req, res) {
  try {
    const { rows } = await query(
      'SELECT id, url, position, is_primary FROM profile_photos WHERE user_id = $1 ORDER BY position ASC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('[listMyPhotos]', err.message);
    res.status(500).json({ error: 'Could not fetch photos.' });
  }
}

// ── POST /api/profile/photos ───────────────────────────────────────────────────
async function addPhoto(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No image file provided.' });

  try {
    const { rows: existing } = await query(
      'SELECT COUNT(*)::int AS count, COALESCE(MAX(position), -1) AS max_position FROM profile_photos WHERE user_id = $1',
      [req.user.id]
    );
    if (existing[0].count >= MAX_PHOTOS) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: `You can have up to ${MAX_PHOTOS} photos.` });
    }

    const url = `/uploads/avatars/${req.file.filename}`;
    const isFirst = existing[0].count === 0;

    const photo = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO profile_photos (user_id, url, position, is_primary)
         VALUES ($1, $2, $3, $4)
         RETURNING id, url, position, is_primary`,
        [req.user.id, url, existing[0].max_position + 1, isFirst]
      );
      if (isFirst) await syncAvatarUrl(client, req.user.id);
      return rows[0];
    });

    res.status(201).json(photo);
  } catch (err) {
    console.error('[addPhoto]', err.message);
    res.status(500).json({ error: 'Could not upload photo.' });
  }
}

// ── DELETE /api/profile/photos/:photoId ────────────────────────────────────────
async function deletePhoto(req, res) {
  const { photoId } = req.params;

  try {
    const { rows } = await query(
      'SELECT url, is_primary FROM profile_photos WHERE id = $1 AND user_id = $2',
      [photoId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Photo not found.' });
    const wasPrimary = rows[0].is_primary;

    await withTransaction(async (client) => {
      await client.query('DELETE FROM profile_photos WHERE id = $1', [photoId]);

      if (wasPrimary) {
        // Promote the next photo by position, if any.
        const { rows: next } = await client.query(
          'SELECT id FROM profile_photos WHERE user_id = $1 ORDER BY position ASC LIMIT 1',
          [req.user.id]
        );
        if (next.length) {
          await client.query('UPDATE profile_photos SET is_primary = TRUE WHERE id = $1', [next[0].id]);
        }
        await syncAvatarUrl(client, req.user.id);
      }
    });

    const oldPath = path.join(__dirname, '..', rows[0].url);
    fs.unlink(oldPath, () => {});

    res.json({ message: 'Photo deleted.' });
  } catch (err) {
    console.error('[deletePhoto]', err.message);
    res.status(500).json({ error: 'Could not delete photo.' });
  }
}

// ── PATCH /api/profile/photos/:photoId/primary ─────────────────────────────────
async function setPrimaryPhoto(req, res) {
  const { photoId } = req.params;

  try {
    const { rows } = await query(
      'SELECT id FROM profile_photos WHERE id = $1 AND user_id = $2',
      [photoId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Photo not found.' });

    await withTransaction(async (client) => {
      await client.query('UPDATE profile_photos SET is_primary = FALSE WHERE user_id = $1', [req.user.id]);
      await client.query('UPDATE profile_photos SET is_primary = TRUE WHERE id = $1', [photoId]);
      await syncAvatarUrl(client, req.user.id);
    });

    res.json({ message: 'Primary photo updated.' });
  } catch (err) {
    console.error('[setPrimaryPhoto]', err.message);
    res.status(500).json({ error: 'Could not update primary photo.' });
  }
}

// ── PATCH /api/profile/photos/reorder ──────────────────────────────────────────
// body: { photo_ids: [uuid, uuid, ...] } — full ordered list of the user's own photos
async function reorderPhotos(req, res) {
  const { photo_ids } = req.body;

  try {
    const { rows: owned } = await query(
      'SELECT id FROM profile_photos WHERE user_id = $1',
      [req.user.id]
    );
    const ownedIds = new Set(owned.map(r => r.id));
    if (photo_ids.length !== owned.length || !photo_ids.every(id => ownedIds.has(id))) {
      return res.status(400).json({ error: 'photo_ids must be exactly your current set of photo IDs.' });
    }

    await withTransaction(async (client) => {
      for (let i = 0; i < photo_ids.length; i++) {
        await client.query('UPDATE profile_photos SET position = $1 WHERE id = $2', [i, photo_ids[i]]);
      }
    });

    res.json({ message: 'Order updated.' });
  } catch (err) {
    console.error('[reorderPhotos]', err.message);
    res.status(500).json({ error: 'Could not reorder photos.' });
  }
}

module.exports = { listMyPhotos, addPhoto, deletePhoto, setPrimaryPhoto, reorderPhotos };
