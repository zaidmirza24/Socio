-- ============================================================================
-- Refresh queue
-- ----------------------------------------------------------------------------
-- Engagement refresh is split into batches of post URLs, one Apify run each. Apify's memory limit
-- is account-wide, so only a few runs may be in flight at once. The batches that do not fit used to
-- wait in the browser tab; they now wait here, so closing the tab loses nothing and a webhook (or
-- any status poll) can start the next batch.
--
-- Status:  queued -> starting -> started   (run_id set; the run itself is tracked in collection_runs)
--          queued -> failed                (could not be started after several attempts)
--          queued -> cancelled             (admin stopped the job)
-- ============================================================================

CREATE TABLE IF NOT EXISTS refresh_queue (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- All batches created by one "start refresh" click share a group, so the UI can follow one job.
  batch_group  UUID NOT NULL,
  platform     TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'x')),
  -- Position inside the group. Claiming by position first interleaves platforms fairly.
  batch_index  INTEGER NOT NULL DEFAULT 0,
  urls         JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'starting', 'started', 'failed', 'cancelled')),
  run_id       TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_queue_pending
  ON refresh_queue (batch_index, created_at)
  WHERE status IN ('queued', 'starting');
CREATE INDEX IF NOT EXISTS idx_refresh_queue_group ON refresh_queue (batch_group);

ALTER TABLE refresh_queue ENABLE ROW LEVEL SECURITY;

-- Team members may read the queue; only the server (service role, which bypasses RLS) writes it.
DROP POLICY IF EXISTS "Authenticated users can read refresh_queue" ON refresh_queue;
CREATE POLICY "Authenticated users can read refresh_queue" ON refresh_queue
  FOR SELECT TO authenticated USING (true);

-- ----------------------------------------------------------------------------
-- claim_refresh_batches: atomically hand out the next batches to start.
--
-- Free slots = p_max_active minus runs already in flight (collection_runs 'started') minus batches
-- another caller is starting right now. An advisory lock serialises callers (webhook + poll can
-- arrive together) and SKIP LOCKED means two callers never get the same batch. A 'starting' claim
-- older than 5 minutes is assumed dead (crashed request) and can be claimed again. Queued batches
-- older than 6 hours are ignored so a forgotten queue never starts days later.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION claim_refresh_batches(p_max_active INTEGER)
RETURNS SETOF refresh_queue
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_in_flight INTEGER;
  v_free INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('claim_refresh_batches'));

  SELECT count(*) INTO v_in_flight
  FROM collection_runs
  WHERE status = 'started' AND started_at > NOW() - INTERVAL '6 hours';

  v_in_flight := v_in_flight + (
    SELECT count(*) FROM refresh_queue
    WHERE status = 'starting' AND updated_at > NOW() - INTERVAL '5 minutes'
  );

  v_free := p_max_active - v_in_flight;
  IF v_free <= 0 THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE refresh_queue q
  SET status = 'starting', updated_at = NOW()
  WHERE q.id IN (
    SELECT id FROM refresh_queue
    WHERE (status = 'queued' AND created_at > NOW() - INTERVAL '6 hours')
       OR (status = 'starting' AND updated_at <= NOW() - INTERVAL '5 minutes')
    ORDER BY batch_index, created_at
    LIMIT v_free
    FOR UPDATE SKIP LOCKED
  )
  RETURNING q.*;
END;
$$;

-- Only the server may call it.
REVOKE ALL ON FUNCTION claim_refresh_batches(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_refresh_batches(INTEGER) TO service_role;
