-- ==============================================================================
-- Migration: 20261119_system_settings_and_scraper_engine.sql
-- Description: Adds schema support for provider-independent scraper engine,
--              last_metrics_refresh_at tracking, thumbnail_url,
--              collection_runs job types and system_settings table with 30-day default.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ADD COLUMNS TO matched_posts AND posts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matched_posts' AND column_name = 'last_metrics_refresh_at'
  ) THEN
    ALTER TABLE matched_posts ADD COLUMN last_metrics_refresh_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'matched_posts' AND column_name = 'thumbnail_url'
  ) THEN
    ALTER TABLE matched_posts ADD COLUMN thumbnail_url TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'last_metrics_refresh_at'
  ) THEN
    ALTER TABLE posts ADD COLUMN last_metrics_refresh_at TIMESTAMPTZ DEFAULT NOW();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'posts' AND column_name = 'thumbnail_url'
  ) THEN
    ALTER TABLE posts ADD COLUMN thumbnail_url TEXT;
  END IF;
END $$;

-- 2. UPDATE collection_runs TABLE FOR PROVIDERS & JOB TYPES
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collection_runs' AND column_name = 'provider'
  ) THEN
    ALTER TABLE collection_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'apify';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collection_runs' AND column_name = 'job_type'
  ) THEN
    ALTER TABLE collection_runs ADD COLUMN job_type TEXT NOT NULL DEFAULT 'discovery';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collection_runs' AND column_name = 'posts_new'
  ) THEN
    ALTER TABLE collection_runs ADD COLUMN posts_new INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'collection_runs' AND column_name = 'posts_refreshed'
  ) THEN
    ALTER TABLE collection_runs ADD COLUMN posts_refreshed INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

ALTER TABLE collection_runs DROP CONSTRAINT IF EXISTS chk_collection_runs_job_type;
ALTER TABLE collection_runs ADD CONSTRAINT chk_collection_runs_job_type CHECK (job_type IN ('discovery', 'refresh', 'direct_url'));

-- 3. UPDATE metric_snapshots SOURCE CHECK
ALTER TABLE metric_snapshots DROP CONSTRAINT IF EXISTS metric_snapshots_source_check;
ALTER TABLE metric_snapshots DROP CONSTRAINT IF EXISTS chk_metric_snapshots_source;
ALTER TABLE metric_snapshots ADD CONSTRAINT chk_metric_snapshots_source CHECK (source IN ('daily_batch', 'direct_url', 'manual_refresh', 'weekly_refresh'));

-- 4. SYSTEM_SETTINGS TABLE FOR RUNTIME CONFIGURATION
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- Seed default scraper refresh strategy (Default mode: 30-day cutoff, 7-day interval)
INSERT INTO system_settings (key, value, updated_at)
VALUES (
  'scraper_refresh_strategy',
  '{
    "mode": "30_day_cutoff",
    "refresh_interval_days": 7,
    "cutoff_days": 30,
    "discovery_post_limit": 10
  }'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;

-- 5. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_matched_posts_refresh_due ON matched_posts(last_metrics_refresh_at, tracking_status, posted_at);
CREATE INDEX IF NOT EXISTS idx_posts_refresh_due ON posts(last_metrics_refresh_at, posted_at);
CREATE INDEX IF NOT EXISTS idx_collection_runs_provider ON collection_runs(provider, started_at DESC);

-- 6. ROW LEVEL SECURITY (RLS) FOR system_settings
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read system_settings" ON system_settings;
CREATE POLICY "Authenticated users can read system_settings" ON system_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins can manage system_settings" ON system_settings;
CREATE POLICY "Admins can manage system_settings" ON system_settings
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

NOTIFY pgrst, 'reload schema';
