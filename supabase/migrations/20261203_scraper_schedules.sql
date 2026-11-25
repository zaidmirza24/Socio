-- ============================================================================
-- Scraper schedules
-- ----------------------------------------------------------------------------
-- An admin picks a date (or a date range), a time (IST) and the platforms. Each schedule is mirrored
-- as one or more Apify Schedules (one per platform per calendar-month segment, because Apify cron
-- has no year and no end date). The Apify schedules run the actor on their own; the app finds those
-- runs afterwards, records them in collection_runs and ingests them (see lib/scheduler/sync.ts).
--
-- Apify Schedules carry a FIXED actor input. The handle list is snapshotted when the schedule is
-- saved (`frozen_handles`); the app compares it with the current accounts and re-saves the input.
--
-- Status:  active    -> its Apify schedules are enabled
--          paused    -> its Apify schedules are disabled
--          completed -> the end date has passed; the Apify schedules were deleted
--          error     -> could not be created or updated at Apify (see last_error)
-- ============================================================================

CREATE TABLE IF NOT EXISTS scraper_schedules (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  job_type          TEXT NOT NULL DEFAULT 'discovery' CHECK (job_type IN ('discovery')),
  mode              TEXT NOT NULL CHECK (mode IN ('once', 'range')),
  -- IST calendar dates. Equal for a one-off schedule.
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  -- HH:MM, IST. The first platform runs at this time; the others follow a few minutes apart.
  run_time          TEXT NOT NULL CHECK (run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  platforms         TEXT[] NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'completed', 'error')),
  -- [{ platform, scheduleId, cron, fireTime, segmentStart, segmentEnd }]
  apify_schedules   JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- { instagram: ["handle1", ...], facebook: [...], x: [...] } the accounts frozen into each
  -- platform's actor input. Kept so a finished run can be logged with the exact accounts it covered.
  frozen_handles    JSONB NOT NULL DEFAULT '{}'::jsonb,
  post_limit        INTEGER NOT NULL DEFAULT 10,
  last_error        TEXT,
  last_synced_at    TIMESTAMPTZ,
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_scraper_schedules_status ON scraper_schedules (status, start_date);

ALTER TABLE scraper_schedules ENABLE ROW LEVEL SECURITY;

-- Team members may read schedules; only the server (service role, which bypasses RLS) writes them.
DROP POLICY IF EXISTS "Authenticated users can read scraper_schedules" ON scraper_schedules;
CREATE POLICY "Authenticated users can read scraper_schedules" ON scraper_schedules
  FOR SELECT TO authenticated USING (true);
