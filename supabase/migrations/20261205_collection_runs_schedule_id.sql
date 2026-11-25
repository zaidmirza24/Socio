-- Links a run to the schedule that started it, so the Scheduler page can show what happened on each
-- planned day. (collection_runs.error cannot carry this: ingestion clears it when a run succeeds.)
ALTER TABLE collection_runs
  ADD COLUMN IF NOT EXISTS schedule_id UUID REFERENCES scraper_schedules(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_collection_runs_schedule
  ON collection_runs (schedule_id, started_at)
  WHERE schedule_id IS NOT NULL;
