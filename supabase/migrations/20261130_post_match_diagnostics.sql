-- ==============================================================================
-- Migration: 20261130_post_match_diagnostics.sql
-- Description:
--   Records WHY each post got its caption-match label, so a genuine post that was not matched
--   can be found and fixed instead of silently sitting as 'unmatched'.
--     posts.match_score           : similarity (0-1) to the closest caption the matcher tried
--     posts.match_best_caption_id : that closest caption (the match itself, or the near-miss)
--     posts.match_reason          : exact | variant | fuzzy | adjacent_day | below_threshold |
--                                   outside_window | empty_caption | no_active_captions
--   'adjacent_day' = matched a caption released the day before/after the post (always reviewed).
-- Safe to re-run (idempotent). Existing rows stay NULL until the next match pass labels them.
-- ==============================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS match_score NUMERIC(5,4);
ALTER TABLE posts ADD COLUMN IF NOT EXISTS match_best_caption_id UUID REFERENCES campaign_captions(id) ON DELETE SET NULL;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS match_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_posts_match_reason') THEN
    ALTER TABLE posts
      ADD CONSTRAINT chk_posts_match_reason
      CHECK (match_reason IS NULL OR match_reason IN (
        'exact', 'variant', 'fuzzy', 'adjacent_day', 'below_threshold',
        'outside_window', 'empty_caption', 'no_active_captions'
      ));
  END IF;
END $$;

-- Near-miss lookups: unmatched posts that came close to a caption, best first.
CREATE INDEX IF NOT EXISTS idx_posts_near_miss
  ON posts (match_score DESC)
  WHERE match_status = 'unmatched' AND match_score IS NOT NULL;
