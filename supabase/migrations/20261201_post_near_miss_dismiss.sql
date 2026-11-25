-- ==============================================================================
-- Migration: 20261201_post_near_miss_dismiss.sql
-- Description:
--   "Possible matches" lane: unmatched posts that scored close to a campaign caption
--   (posts.match_score, see 20261130) are listed for an admin. Dismissing one ("not a campaign
--   post") only hides it from that list. The post stays 'unmatched', keeps being refreshed and
--   keeps its history (nothing is discarded or frozen).
-- Safe to re-run (idempotent).
-- ==============================================================================

ALTER TABLE posts ADD COLUMN IF NOT EXISTS match_dismissed_at TIMESTAMPTZ;

-- The lane's query: recent unmatched below-threshold posts that are not dismissed.
DROP INDEX IF EXISTS idx_posts_near_miss;
CREATE INDEX IF NOT EXISTS idx_posts_near_miss
  ON posts (match_score DESC)
  WHERE match_status = 'unmatched' AND match_reason = 'below_threshold' AND match_dismissed_at IS NULL;
