-- ==============================================================================
-- Migration: 20261126_security_and_tracking_fixes.sql
-- 1. handle_new_user: role comes from app metadata (server-only), never from the signup
--    form's user metadata. Fixes self-signup as admin.
-- 2. collection_runs: 'ingesting' status + ingest_claimed_at so only one request ingests a run.
-- 3. posts.match_status: 'rejected' (admin rejected the fuzzy match; post and history are kept
--    but it is no longer refreshed).
-- ==============================================================================

-- 1. Safe profile creation -----------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  user_count INTEGER;
  requested_role TEXT;
  assigned_role TEXT;
BEGIN
  -- Serialise concurrent signups so two "first users" cannot both become admin.
  PERFORM pg_advisory_xact_lock(hashtext('public.handle_new_user'));

  SELECT COUNT(*) INTO user_count FROM public.profiles;

  -- raw_app_meta_data can only be set with the service-role key (e.g. /api/admin/users).
  -- raw_user_meta_data is controlled by whoever signs up and must never grant a role.
  requested_role := new.raw_app_meta_data->>'role';

  IF user_count = 0 THEN
    assigned_role := 'admin';
  ELSIF requested_role IN ('admin', 'member') THEN
    assigned_role := requested_role;
  ELSE
    assigned_role := 'member';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    new.id,
    new.email,
    COALESCE(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    assigned_role
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, profiles.full_name),
    role = CASE
      WHEN profiles.role = 'admin' THEN 'admin'
      ELSE EXCLUDED.role
    END;

  RETURN new;
END;
$$;

-- Demote anyone who used the old hole: members whose only claim to admin was user metadata.
-- (Admins created through /api/admin/users before this fix also carried the role in user
-- metadata, so this is reported rather than changed automatically.)
DO $$
DECLARE
  suspicious INTEGER;
BEGIN
  SELECT COUNT(*) INTO suspicious
  FROM public.profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE p.role = 'admin'
    AND (u.raw_app_meta_data->>'role') IS DISTINCT FROM 'admin';
  IF suspicious > 0 THEN
    RAISE NOTICE 'Review % admin profile(s) whose role was not granted via app metadata.', suspicious;
  END IF;
END $$;

-- 2. Run ingestion claim ---------------------------------------------------------
ALTER TABLE collection_runs DROP CONSTRAINT IF EXISTS collection_runs_status_check;
ALTER TABLE collection_runs DROP CONSTRAINT IF EXISTS chk_collection_runs_status;
ALTER TABLE collection_runs ADD CONSTRAINT chk_collection_runs_status
  CHECK (status IN ('started', 'ingesting', 'success', 'failed', 'partial'));

ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS ingest_claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_collection_runs_active
  ON collection_runs(platform, job_type, started_at DESC)
  WHERE status IN ('started', 'ingesting');

-- 3. Rejected posts ----------------------------------------------------------------
ALTER TABLE posts DROP CONSTRAINT IF EXISTS chk_posts_match_status;
ALTER TABLE posts ADD CONSTRAINT chk_posts_match_status
  CHECK (match_status IN ('unmatched', 'matched', 'needs_review', 'rejected'));

-- 4. Metric integrity: growth is NULL when either side was not measured (never a fake 0) ----
ALTER TABLE metric_snapshots ALTER COLUMN delta_likes DROP NOT NULL;
ALTER TABLE metric_snapshots ALTER COLUMN delta_likes DROP DEFAULT;
ALTER TABLE metric_snapshots ALTER COLUMN delta_comments DROP NOT NULL;
ALTER TABLE metric_snapshots ALTER COLUMN delta_comments DROP DEFAULT;
ALTER TABLE metric_snapshots ALTER COLUMN delta_views DROP NOT NULL;
ALTER TABLE metric_snapshots ALTER COLUMN delta_views DROP DEFAULT;
ALTER TABLE metric_snapshots ALTER COLUMN delta_shares DROP NOT NULL;
ALTER TABLE metric_snapshots ALTER COLUMN delta_shares DROP DEFAULT;

-- Historic rows: a 0 delta next to an unmeasured value was never a real measurement.
UPDATE metric_snapshots SET delta_likes = NULL    WHERE likes IS NULL    AND delta_likes = 0;
UPDATE metric_snapshots SET delta_comments = NULL WHERE comments IS NULL AND delta_comments = 0;
UPDATE metric_snapshots SET delta_views = NULL    WHERE views IS NULL    AND delta_views = 0;
UPDATE metric_snapshots SET delta_shares = NULL   WHERE shares IS NULL   AND delta_shares = 0;

-- 5. Snapshot dates default to the IST calendar day (writers pass it explicitly; this is a safety net)
ALTER TABLE post_snapshots    ALTER COLUMN snapshot_date SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date;
ALTER TABLE account_snapshots ALTER COLUMN snapshot_date SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date;
ALTER TABLE metric_snapshots  ALTER COLUMN snapshot_date SET DEFAULT (now() AT TIME ZONE 'Asia/Kolkata')::date;

-- 6. Run counters that used to be invisible ------------------------------------------------
ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS posts_skipped_unknown    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS posts_outside_day_window INTEGER NOT NULL DEFAULT 0;

-- 7. Indexes for common filters ---------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_posts_matched_caption_id ON posts(matched_caption_id);
CREATE INDEX IF NOT EXISTS idx_posts_match_status_posted ON posts(match_status, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_platform_posted ON posts(platform, posted_at DESC);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_posts_caption_trgm ON posts USING gin (caption gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_post_snapshots_post_date_desc ON post_snapshots(post_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_post_date_desc ON metric_snapshots(post_id, snapshot_date DESC);

-- 8. Latest snapshot per post, computed in SQL instead of downloading full histories -----------
CREATE OR REPLACE VIEW post_latest_snapshot
WITH (security_invoker = true) AS
SELECT DISTINCT ON (ps.post_id)
  ps.post_id, ps.snapshot_date, ps.likes, ps.comments, ps.shares, ps.views, ps.quotes
FROM post_snapshots ps
ORDER BY ps.post_id, ps.snapshot_date DESC;

CREATE OR REPLACE VIEW matched_post_latest_metrics
WITH (security_invoker = true) AS
SELECT DISTINCT ON (ms.post_id)
  ms.post_id, ms.snapshot_date, ms.likes, ms.comments, ms.views, ms.shares
FROM metric_snapshots ms
ORDER BY ms.post_id, ms.snapshot_date DESC;

GRANT SELECT ON post_latest_snapshot TO authenticated, service_role;
GRANT SELECT ON matched_post_latest_metrics TO authenticated, service_role;

-- 9. Per-volunteer totals for ONE platform (the Volunteers page platform filter) ---------------
CREATE OR REPLACE VIEW volunteer_platform_totals
WITH (security_invoker = true) AS
SELECT
  v.id                 AS volunteer_id,
  v.name               AS name,
  a.platform           AS platform,
  COUNT(DISTINCT a.id) AS accounts_count,
  COUNT(p.id)          AS posts_count,
  SUM(ls.likes)        AS total_likes,
  SUM(ls.comments)     AS total_comments,
  SUM(ls.shares)       AS total_shares,
  SUM(ls.views)        AS total_views,
  MAX(p.posted_at)     AS last_posted_at
FROM volunteers v
JOIN accounts a ON a.volunteer_id = v.id
LEFT JOIN posts p ON p.account_id = a.id
LEFT JOIN post_latest_snapshot ls ON ls.post_id = p.id
GROUP BY v.id, v.name, a.platform;

GRANT SELECT ON volunteer_platform_totals TO authenticated, service_role;
