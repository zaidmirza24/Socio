-- ==============================================================================
-- Migration: 20261202_tier1_core.sql
-- Description:
--   Tier 1D ("tier1_core"): a post whose campaign text is identical to a caption once the
--   volunteer's greeting / hashtags / sign-off are stripped is auto-matched. It is recorded as
--   its own tier so it can always be told apart from a word-for-word match.
--     matched_posts.match_tier   : adds 'tier1_core'
--     posts.match_reason         : adds 'core'
-- Safe to re-run (idempotent).
-- ==============================================================================

-- matched_posts.match_tier was created with an unnamed CHECK, so find it by its definition.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'matched_posts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%match_tier%'
  LOOP
    EXECUTE format('ALTER TABLE matched_posts DROP CONSTRAINT %I', c.conname);
  END LOOP;

  ALTER TABLE matched_posts
    ADD CONSTRAINT chk_matched_posts_match_tier
    CHECK (match_tier IN ('tier1_exact', 'tier1_core', 'tier2_fuzzy', 'manual_approved'));
END $$;

ALTER TABLE posts DROP CONSTRAINT IF EXISTS chk_posts_match_reason;
ALTER TABLE posts
  ADD CONSTRAINT chk_posts_match_reason
  CHECK (match_reason IS NULL OR match_reason IN (
    'exact', 'core', 'variant', 'fuzzy', 'adjacent_day', 'below_threshold',
    'outside_window', 'empty_caption', 'no_active_captions'
  ));
