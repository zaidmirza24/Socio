-- ==============================================================================
-- Migration: 20261207_dashboard_gain_functions.sql
--
-- Moves the dashboard's "gain over the period" math from Node into SQL (AGENTS.md §3).
-- Before: the app downloaded every snapshot of the period 1000 rows at a time and computed
-- gains in JavaScript. After: these functions return already-aggregated, small results.
--
-- The rules are exactly those of lib/metrics/gain.ts (tests/dashboard_sql.test.ts checks that
-- both give the same numbers on random data):
--   * snapshots hold CUMULATIVE totals; gain = latest value in the period minus the last
--     MEASURED (non-null) value before the period (0 when there is none);
--   * gain never goes below 0; a NULL latest value stays NULL ("not measured");
--   * daily gain = a day's value minus the last measured value before that day;
--   * when summing, NULL adds nothing.
-- "since" is an IST calendar date (YYYY-MM-DD); NULL means all time. Platform 'all' = no filter.
--
-- SECURITY INVOKER (the default): the caller's RLS applies, same as the queries they replace.
-- ==============================================================================

-- One row per snapshot of every post that has a snapshot on/after p_since, with the last
-- measured value strictly before it (prev_*). Fill-forward per metric, then look one row back.
CREATE OR REPLACE FUNCTION public.dashboard_snapshot_series(p_since DATE)
RETURNS TABLE (
  post_id UUID,
  snapshot_date DATE,
  likes INTEGER,
  comments INTEGER,
  views INTEGER,
  prev_likes INTEGER,
  prev_comments INTEGER,
  prev_views INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH active AS (
    SELECT DISTINCT ps.post_id
    FROM post_snapshots ps
    WHERE p_since IS NULL OR ps.snapshot_date >= p_since
  ),
  numbered AS (
    SELECT ps.post_id, ps.snapshot_date, ps.likes, ps.comments, ps.views,
           COUNT(ps.likes)    OVER w AS gl,
           COUNT(ps.comments) OVER w AS gc,
           COUNT(ps.views)    OVER w AS gv
    FROM post_snapshots ps
    JOIN active a ON a.post_id = ps.post_id
    WINDOW w AS (PARTITION BY ps.post_id ORDER BY ps.snapshot_date)
  ),
  filled AS (
    SELECT n.*,
           MAX(n.likes)    OVER (PARTITION BY n.post_id, n.gl) AS fl,
           MAX(n.comments) OVER (PARTITION BY n.post_id, n.gc) AS fc,
           MAX(n.views)    OVER (PARTITION BY n.post_id, n.gv) AS fv
    FROM numbered n
  )
  SELECT f.post_id, f.snapshot_date, f.likes, f.comments, f.views,
         LAG(f.fl) OVER w2, LAG(f.fc) OVER w2, LAG(f.fv) OVER w2
  FROM filled f
  WINDOW w2 AS (PARTITION BY f.post_id ORDER BY f.snapshot_date)
$$;

-- Gain per post over the period, joined with its account (posts without an account are skipped).
CREATE OR REPLACE FUNCTION public.dashboard_post_gains(p_since DATE, p_platform TEXT)
RETURNS TABLE (
  post_id UUID,
  account_id UUID,
  likes INTEGER,
  comments INTEGER,
  views INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH in_window AS (
    SELECT s.*
    FROM dashboard_snapshot_series(p_since) s
    WHERE p_since IS NULL OR s.snapshot_date >= p_since
  ),
  latest AS (
    SELECT DISTINCT ON (w.post_id) w.post_id, w.likes, w.comments, w.views
    FROM in_window w
    ORDER BY w.post_id, w.snapshot_date DESC
  ),
  -- The first row in the period carries the last measured value BEFORE the period.
  baseline AS (
    SELECT DISTINCT ON (w.post_id) w.post_id, w.prev_likes, w.prev_comments, w.prev_views
    FROM in_window w
    ORDER BY w.post_id, w.snapshot_date ASC
  )
  SELECT l.post_id,
         p.account_id,
         CASE WHEN l.likes    IS NULL THEN NULL ELSE GREATEST(0, l.likes    - COALESCE(b.prev_likes, 0))    END,
         CASE WHEN l.comments IS NULL THEN NULL ELSE GREATEST(0, l.comments - COALESCE(b.prev_comments, 0)) END,
         CASE WHEN l.views    IS NULL THEN NULL ELSE GREATEST(0, l.views    - COALESCE(b.prev_views, 0))    END
  FROM latest l
  JOIN baseline b ON b.post_id = l.post_id
  JOIN posts p    ON p.id = l.post_id
  JOIN accounts a ON a.id = p.account_id
  WHERE p_platform IS NULL OR p_platform = 'all' OR COALESCE(a.platform, 'instagram') = p_platform
$$;

-- Per account: posts with activity and the likes / comments / views they gained.
-- Feeds the KPIs, volunteer engagement, account comparison and the leaderboard.
CREATE OR REPLACE FUNCTION public.dashboard_account_gains(p_since DATE, p_platform TEXT)
RETURNS TABLE (
  account_id UUID,
  handle TEXT,
  platform TEXT,
  volunteer_id UUID,
  volunteer_name TEXT,
  posts BIGINT,
  likes BIGINT,
  comments BIGINT,
  views BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT a.id,
         a.handle,
         COALESCE(a.platform, 'instagram'),
         a.volunteer_id,
         COALESCE(a.volunteer_name, a.handle),
         COUNT(*),
         COALESCE(SUM(g.likes), 0),
         COALESCE(SUM(g.comments), 0),
         COALESCE(SUM(g.views), 0)
  FROM dashboard_post_gains(p_since, p_platform) g
  JOIN accounts a ON a.id = g.account_id
  GROUP BY a.id, a.handle, a.platform, a.volunteer_id, a.volunteer_name
$$;

-- Top posts by likes + comments gained in the period.
CREATE OR REPLACE FUNCTION public.dashboard_top_posts(p_since DATE, p_platform TEXT, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
  post_id UUID,
  handle TEXT,
  caption TEXT,
  likes BIGINT,
  comments BIGINT,
  views BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT g.post_id,
         a.handle,
         p.caption,
         COALESCE(g.likes, 0)::BIGINT,
         COALESCE(g.comments, 0)::BIGINT,
         COALESCE(g.views, 0)::BIGINT
  FROM dashboard_post_gains(p_since, p_platform) g
  JOIN posts p    ON p.id = g.post_id
  JOIN accounts a ON a.id = g.account_id
  ORDER BY COALESCE(g.likes, 0) + COALESCE(g.comments, 0) DESC, g.post_id
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 100))
$$;

-- Gain per post per snapshot day (days on/after p_since), with the account and volunteer.
CREATE OR REPLACE FUNCTION public.dashboard_daily_gains(p_since DATE, p_platform TEXT)
RETURNS TABLE (
  day DATE,
  post_id UUID,
  volunteer_key TEXT,
  volunteer_name TEXT,
  likes INTEGER,
  comments INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT s.snapshot_date,
         s.post_id,
         COALESCE(a.volunteer_id::TEXT, 'acct:' || a.id::TEXT),
         COALESCE(a.volunteer_name, a.handle),
         CASE WHEN s.likes    IS NULL THEN NULL ELSE GREATEST(0, s.likes    - COALESCE(s.prev_likes, 0))    END,
         CASE WHEN s.comments IS NULL THEN NULL ELSE GREATEST(0, s.comments - COALESCE(s.prev_comments, 0)) END
  FROM dashboard_snapshot_series(p_since) s
  JOIN posts p    ON p.id = s.post_id
  JOIN accounts a ON a.id = p.account_id
  WHERE (p_since IS NULL OR s.snapshot_date >= p_since)
    AND (p_platform IS NULL OR p_platform = 'all' OR COALESCE(a.platform, 'instagram') = p_platform)
$$;

-- Likes and comments gained on each day (trend chart).
CREATE OR REPLACE FUNCTION public.dashboard_daily_trend(p_since DATE, p_platform TEXT)
RETURNS TABLE (day DATE, likes BIGINT, comments BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT d.day, COALESCE(SUM(d.likes), 0), COALESCE(SUM(d.comments), 0)
  FROM dashboard_daily_gains(p_since, p_platform) d
  GROUP BY d.day
  ORDER BY d.day
$$;

-- The best volunteer of each day ('-' with 0 when nobody gained anything that day).
CREATE OR REPLACE FUNCTION public.dashboard_daily_top_volunteer(p_since DATE, p_platform TEXT)
RETURNS TABLE (day DATE, volunteer_name TEXT, engagement BIGINT)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH per_volunteer AS (
    SELECT d.day, d.volunteer_key, MIN(d.volunteer_name) AS volunteer_name,
           COALESCE(SUM(d.likes), 0) + COALESCE(SUM(d.comments), 0) AS engagement
    FROM dashboard_daily_gains(p_since, p_platform) d
    GROUP BY d.day, d.volunteer_key
  ),
  best AS (
    SELECT DISTINCT ON (pv.day) pv.day, pv.volunteer_name, pv.engagement
    FROM per_volunteer pv
    ORDER BY pv.day, pv.engagement DESC, pv.volunteer_key
  )
  SELECT b.day,
         CASE WHEN b.engagement > 0 THEN b.volunteer_name ELSE '-' END,
         CASE WHEN b.engagement > 0 THEN b.engagement ELSE 0 END
  FROM best b
  ORDER BY b.day
$$;

-- Signed-in team members only (RLS still applies inside, as SECURITY INVOKER).
REVOKE ALL ON FUNCTION public.dashboard_snapshot_series(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_post_gains(DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_account_gains(DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_top_posts(DATE, TEXT, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_daily_gains(DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_daily_trend(DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_daily_top_volunteer(DATE, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dashboard_snapshot_series(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_post_gains(DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_account_gains(DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_top_posts(DATE, TEXT, INTEGER) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_gains(DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_trend(DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_daily_top_volunteer(DATE, TEXT) TO authenticated, service_role;
