-- ==============================================================================
-- Migration: 20261124_account_stats_view.sql
-- Description:
--   account_stats: per-account post count and latest follower count, computed in SQL so the
--   Accounts page stays correct and fast with 1000+ accounts / 100k+ posts (the API used to
--   count in JavaScript and was silently capped at 1000 rows).
-- Safe to re-run (idempotent).
-- ==============================================================================

CREATE OR REPLACE VIEW account_stats
WITH (security_invoker = true) AS
SELECT
  a.id AS account_id,
  COALESCE(pc.posts_count, 0) AS posts_count,
  ls.followers AS followers
FROM accounts a
LEFT JOIN (
  SELECT account_id, COUNT(*) AS posts_count FROM posts GROUP BY account_id
) pc ON pc.account_id = a.id
LEFT JOIN LATERAL (
  SELECT s.followers
  FROM account_snapshots s
  WHERE s.account_id = a.id
  ORDER BY s.snapshot_date DESC
  LIMIT 1
) ls ON TRUE;
