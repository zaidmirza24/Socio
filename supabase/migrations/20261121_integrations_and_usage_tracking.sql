-- ==============================================================================
-- Migration: 20261121_integrations_and_usage_tracking.sql
-- Description:
--   1. integration_secrets  : AES-256-GCM encrypted credentials (Apify token,
--                             webhook secret) managed from Settings UI.
--                             Service-role ONLY - no policy for authenticated users.
--   2. collection_runs      : per-run Apify cost columns (usage_usd, breakdown, CU).
--   3. apify_usage_daily    : SQL view aggregating cost per day / platform / job type.
-- Safe to re-run (idempotent).
-- ==============================================================================

-- 1. ENCRYPTED SECRETS ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS integration_secrets (
  key         TEXT PRIMARY KEY,
  ciphertext  TEXT NOT NULL,                       -- "v1:<iv>:<tag>:<data>" (base64)
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- RLS on with NO policies = invisible to anon/authenticated. Only the
-- service-role key (server-side) can read or write this table.
ALTER TABLE integration_secrets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON integration_secrets FROM anon, authenticated;

-- 2. APIFY COST COLUMNS ON collection_runs --------------------------------------
ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS usage_usd        NUMERIC(12, 6);
ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS usage_breakdown  JSONB;
ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS compute_units    NUMERIC(12, 4);
ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS usage_synced_at  TIMESTAMPTZ;

-- Fast lookup of runs whose cost has not been pulled from Apify yet
CREATE INDEX IF NOT EXISTS idx_collection_runs_usage_pending
  ON collection_runs(started_at DESC)
  WHERE usage_synced_at IS NULL AND actor_run_id IS NOT NULL;

-- 3. DAILY USAGE VIEW -----------------------------------------------------------
-- Aggregation lives in SQL (AGENTS.md rule). Day boundary uses IST because the
-- Apify schedule fires at 08:00 IST; this keeps one daily run on one date.
CREATE OR REPLACE VIEW apify_usage_daily
WITH (security_invoker = true) AS
SELECT
  (started_at AT TIME ZONE 'Asia/Kolkata')::date AS usage_date,
  platform,
  job_type,
  COUNT(*)                                       AS runs,
  COUNT(*) FILTER (WHERE usage_synced_at IS NULL) AS runs_pending_cost,
  COALESCE(SUM(usage_usd), 0)::numeric(12, 6)    AS usage_usd,
  COALESCE(SUM(compute_units), 0)::numeric(12, 4) AS compute_units,
  COALESCE(SUM(posts_found), 0)::int             AS posts_found,
  COALESCE(SUM(posts_upserted), 0)::int          AS posts_upserted
FROM collection_runs
WHERE actor_run_id IS NOT NULL
GROUP BY 1, 2, 3;

NOTIFY pgrst, 'reload schema';
