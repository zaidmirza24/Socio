-- Minutes between platforms on a run day (0 = all platforms at the same time). Set per schedule.
ALTER TABLE scraper_schedules
  ADD COLUMN IF NOT EXISTS gap_minutes INTEGER NOT NULL DEFAULT 10
  CHECK (gap_minutes BETWEEN 0 AND 120);
