-- ============================================================
-- Fantasi — Migration 005
-- Backs Dashboard/Interests.html's three tabs (Viewed me / Liked /
-- Liked me), which previously read from localStorage and had no
-- server-side concept of a like or a profile view at all.
-- ============================================================

BEGIN;

CREATE TABLE profile_likes (
  liker_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  liked_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (liker_id, liked_id),
  CONSTRAINT chk_no_self_like CHECK (liker_id <> liked_id)
);
CREATE INDEX idx_profile_likes_liked ON profile_likes (liked_id, created_at DESC);

-- One row per (viewer, viewed) pair — re-viewing just bumps viewed_at,
-- since the UI shows "when did you last look", not a full visit log.
CREATE TABLE profile_views (
  viewer_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (viewer_id, viewed_id),
  CONSTRAINT chk_no_self_view CHECK (viewer_id <> viewed_id)
);
CREATE INDEX idx_profile_views_viewed ON profile_views (viewed_id, viewed_at DESC);

COMMIT;
