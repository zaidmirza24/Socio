-- ==============================================================================
-- Migration: 20261123_post_match_status.sql
-- Description:
--   Every scraped post is kept and keeps being refreshed. Caption matching only LABELS it.
--   1. posts.match_status      : 'unmatched' | 'matched' | 'needs_review'
--   2. posts.matched_caption_id: the campaign caption it matched (when matched)
--   3. unique actor_run_id     : a scraper run can be ingested only once.
-- Safe to re-run (idempotent).
-- ==============================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS match_status TEXT NOT NULL DEFAULT 'unmatched';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_posts_match_status'
  ) THEN
    ALTER TABLE posts
      ADD CONSTRAINT chk_posts_match_status
      CHECK (match_status IN ('unmatched', 'matched', 'needs_review'));
  END IF;
END $$;

ALTER TABLE posts ADD COLUMN IF NOT EXISTS matched_caption_id UUID REFERENCES campaign_captions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_posts_match_status ON posts(match_status);

-- Posts that were already exact-matched before this migration are labelled 'matched'
UPDATE posts p
SET match_status = 'matched', matched_caption_id = mp.caption_id
FROM matched_posts mp
WHERE mp.platform = p.platform
  AND mp.platform_post_id = p.platform_post_id
  AND p.match_status = 'unmatched';

-- One collection_runs row per Apify run (NULL actor_run_id rows are unaffected)
CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_runs_actor_run_id
  ON collection_runs(actor_run_id) WHERE actor_run_id IS NOT NULL;
