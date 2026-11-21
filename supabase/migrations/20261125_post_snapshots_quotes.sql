-- X quote-tweet count. NULL = not measured / not supported on the platform (never 0 by default).
ALTER TABLE post_snapshots ADD COLUMN IF NOT EXISTS quotes INTEGER;
