-- ============================================================
-- Fantasi — Migration 011
-- A Twitter-style forum: any approved member can view/like/comment,
-- only Gold/Black can post or repost (enforced in the controller via
-- requireTier, not here — Postgres has no clean way to check a
-- cross-table membership_tier in a CHECK constraint).
-- ============================================================

BEGIN;

CREATE TABLE forum_posts (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body          TEXT        CHECK (char_length(body) <= 2000),
  -- A repost with no added commentary has body = NULL; a quote-repost has
  -- both body and repost_of_id set.
  repost_of_id  UUID        REFERENCES forum_posts(id) ON DELETE SET NULL,
  is_deleted    BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_body_or_repost CHECK (body IS NOT NULL OR repost_of_id IS NOT NULL)
);

CREATE INDEX idx_forum_posts_feed       ON forum_posts (created_at DESC) WHERE is_deleted = FALSE;
CREATE INDEX idx_forum_posts_author     ON forum_posts (author_id, created_at DESC);
CREATE INDEX idx_forum_posts_repost_of  ON forum_posts (repost_of_id) WHERE repost_of_id IS NOT NULL;

CREATE TABLE forum_post_likes (
  post_id     UUID        NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE forum_comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     UUID        NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body        TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  is_deleted  BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forum_comments_post ON forum_comments (post_id, created_at ASC);

-- Who's tagged in a post — drives both the "@name" render-as-link on the
-- frontend and the mention notification.
CREATE TABLE forum_mentions (
  post_id            UUID NOT NULL REFERENCES forum_posts(id) ON DELETE CASCADE,
  mentioned_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, mentioned_user_id)
);

CREATE TYPE forum_notification_type AS ENUM ('mention', 'comment', 'like', 'repost');

CREATE TABLE forum_notifications (
  id          UUID                     PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- recipient
  actor_id    UUID                     NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- who triggered it
  type        forum_notification_type  NOT NULL,
  post_id     UUID                     REFERENCES forum_posts(id) ON DELETE CASCADE,
  is_read     BOOLEAN                  NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ              NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forum_notifications_user ON forum_notifications (user_id, created_at DESC);

COMMIT;
