-- ==============================================================================
-- Migration: 20261208_run_start_locks.sql
--
-- Starting a paid Apify run takes a few seconds (load accounts, call Apify, write the audit row).
-- The app checks "is a run of this platform + job type already active?" first, but two requests
-- inside those seconds can both pass the check and pay for two identical runs. Inside one server
-- an in-process lock prevents that; this table extends it to separate copies of the app (two admins
-- each running their own local copy against the shared database).
--
-- try_lock_run_start  atomically takes the lock for (platform, job type), or takes over one older
--                     than p_ttl_seconds (a request that crashed). Returns TRUE when acquired.
-- release_run_start   frees it, but only for the holder of p_token (a request that outlived its
--                     TTL cannot release a lock someone else has since taken).
-- Only the server (service role) may call them.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS run_start_locks (
  platform   TEXT NOT NULL,
  job_type   TEXT NOT NULL CHECK (job_type IN ('discovery', 'refresh')),
  token      UUID NOT NULL,
  locked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (platform, job_type)
);

ALTER TABLE run_start_locks ENABLE ROW LEVEL SECURITY;
-- No policies: team members never read or write it; the service role bypasses RLS.
REVOKE ALL ON run_start_locks FROM anon, authenticated;

CREATE OR REPLACE FUNCTION try_lock_run_start(
  p_platform TEXT,
  p_job_type TEXT,
  p_token UUID,
  p_ttl_seconds INTEGER DEFAULT 120
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  INSERT INTO run_start_locks (platform, job_type, token, locked_at)
  VALUES (p_platform, p_job_type, p_token, NOW())
  ON CONFLICT (platform, job_type) DO UPDATE
    SET token = EXCLUDED.token, locked_at = EXCLUDED.locked_at
    WHERE run_start_locks.locked_at < NOW() - make_interval(secs => GREATEST(p_ttl_seconds, 10));
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

CREATE OR REPLACE FUNCTION release_run_start(p_platform TEXT, p_job_type TEXT, p_token UUID)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM run_start_locks
  WHERE platform = p_platform AND job_type = p_job_type AND token = p_token;
$$;

REVOKE ALL ON FUNCTION try_lock_run_start(TEXT, TEXT, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_run_start(TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION try_lock_run_start(TEXT, TEXT, UUID, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION release_run_start(TEXT, TEXT, UUID) TO service_role;
