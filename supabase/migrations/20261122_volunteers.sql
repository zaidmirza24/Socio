-- ==============================================================================
-- Migration: 20261122_volunteers.sql
-- Description:
--   One VOLUNTEER can own up to 3 monitored accounts (Instagram, Facebook, X).
--   1. volunteers            : the person.
--   2. accounts.volunteer_id : links each platform account to its volunteer
--                              (max one account per platform per volunteer).
--   3. volunteer_totals      : SQL roll-up of posts and latest engagement across
--                              all of a volunteer's accounts.
-- Safe to re-run (idempotent). Assumes no pre-existing volunteer data to migrate;
-- any existing account rows are grouped by volunteer_name for completeness.
-- ==============================================================================

-- 1. VOLUNTEERS ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS volunteers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_volunteers_name_lower ON volunteers (LOWER(name));

-- 2. LINK ACCOUNTS -> VOLUNTEERS -------------------------------------------------
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS volunteer_id UUID REFERENCES volunteers(id) ON DELETE CASCADE;

-- Group any rows that already exist by name (one volunteer per distinct name)
INSERT INTO volunteers (name)
SELECT DISTINCT a.volunteer_name
FROM accounts a
WHERE a.volunteer_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM volunteers v WHERE LOWER(v.name) = LOWER(a.volunteer_name));

UPDATE accounts a
SET volunteer_id = (
  SELECT v.id FROM volunteers v WHERE LOWER(v.name) = LOWER(a.volunteer_name) ORDER BY v.created_at LIMIT 1
)
WHERE a.volunteer_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_volunteer_id ON accounts(volunteer_id);

-- A volunteer has at most one account per platform
CREATE UNIQUE INDEX IF NOT EXISTS uq_accounts_volunteer_platform
  ON accounts (volunteer_id, platform) WHERE volunteer_id IS NOT NULL;

-- 3. RLS -----------------------------------------------------------------------
ALTER TABLE volunteers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read volunteers" ON volunteers;
CREATE POLICY "Authenticated users can read volunteers" ON volunteers
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage volunteers" ON volunteers;
CREATE POLICY "Admins can manage volunteers" ON volunteers
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- 4. PER-VOLUNTEER ROLL-UP ---------------------------------------------------------
-- Engagement = each post's most recent snapshot, summed across all platforms.
-- NULL stays NULL when nothing was measured (SUM ignores NULLs, and is NULL if all are).
CREATE OR REPLACE VIEW volunteer_totals
WITH (security_invoker = true) AS
SELECT
  v.id                                         AS volunteer_id,
  v.name                                       AS name,
  COUNT(DISTINCT a.id)                         AS accounts_count,
  COUNT(DISTINCT a.id) FILTER (WHERE a.platform = 'instagram') AS instagram_accounts,
  COUNT(DISTINCT a.id) FILTER (WHERE a.platform = 'facebook')  AS facebook_accounts,
  COUNT(DISTINCT a.id) FILTER (WHERE a.platform = 'x')         AS x_accounts,
  COUNT(p.id)                                  AS posts_count,
  SUM(ls.likes)                                AS total_likes,
  SUM(ls.comments)                             AS total_comments,
  SUM(ls.shares)                               AS total_shares,
  SUM(ls.views)                                AS total_views,
  MAX(p.posted_at)                             AS last_posted_at
FROM volunteers v
LEFT JOIN accounts a ON a.volunteer_id = v.id
LEFT JOIN posts p ON p.account_id = a.id
LEFT JOIN LATERAL (
  SELECT s.likes, s.comments, s.shares, s.views
  FROM post_snapshots s
  WHERE s.post_id = p.id
  ORDER BY s.snapshot_date DESC
  LIMIT 1
) ls ON TRUE
GROUP BY v.id, v.name;
