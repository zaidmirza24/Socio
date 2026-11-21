-- ==============================================================================
-- Migration: 20261120_multi_platform_expansion.sql
-- Description: Non-breaking additive schema additions for multi-platform support
--              (Instagram, Facebook, X/Twitter). Adds public share & repost metrics
--              to metric_snapshots and creates performance indexes for multi-platform lookups.
-- ==============================================================================

-- 1. ADD SHARES AND DELTA_SHARES TO metric_snapshots
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'metric_snapshots' AND column_name = 'shares'
  ) THEN
    ALTER TABLE metric_snapshots ADD COLUMN shares INTEGER;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'metric_snapshots' AND column_name = 'delta_shares'
  ) THEN
    ALTER TABLE metric_snapshots ADD COLUMN delta_shares INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 2. CREATE MULTI-PLATFORM ACCOUNT LOOKUP INDEX
CREATE INDEX IF NOT EXISTS idx_accounts_platform_handle 
  ON accounts(platform, handle);

-- 3. CREATE PLATFORM INDEX FOR AUDIT QUERIES
CREATE INDEX IF NOT EXISTS idx_collection_runs_platform 
  ON collection_runs(platform);
