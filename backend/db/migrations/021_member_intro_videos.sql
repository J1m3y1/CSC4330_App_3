-- Private member introduction videos. These are deliberately stored outside
-- the public uploads mount and are streamed only after an authenticated,
-- Black-tier authorization check in profileController.
CREATE TABLE IF NOT EXISTS member_intro_videos (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  storage_key       TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  mime_type         TEXT NOT NULL CHECK (mime_type IN ('video/mp4', 'video/webm', 'video/quicktime')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_member_intro_videos_updated_at
  BEFORE UPDATE ON member_intro_videos
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
