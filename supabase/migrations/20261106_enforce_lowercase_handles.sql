-- ==============================================================================
-- Migration: 20261106_enforce_lowercase_handles.sql
-- Description: Enforce lowercase handles and add a guard-rail CHECK constraint.
--
-- Root cause (actual): The ingestion pipeline was auto-inserting a new account
--   row for every ownerUsername that appeared in the Apify dataset, including
--   accounts that were never added to the monitored list (tagged profiles, related
--   accounts, etc.). This caused the accounts count to grow from 48 → 84 across
--   runs (36 ghost accounts created in a single run on 2026-11-06).
--
-- Application-level fix (already applied to lib/services/ingestion.ts):
--   Removed the auto-insert block entirely. The accounts table is now the
--   authoritative list of monitored volunteers. Only accounts explicitly added
--   via the UI/admin are tracked; unknown handles from the scraper are skipped.
--
-- Data cleanup (already run via script on 2026-11-06):
--   Deleted 36 ghost accounts (volunteer_name === handle, added ≥ 07:34 UTC).
--   Accounts restored to 48.
--
-- This migration adds a DB-level CHECK constraint as a belt-and-suspenders guard:
--   - Lowercases any remaining mixed-case handles (should be none after cleanup).
--   - Enforces lowercase on all future inserts/updates at the DB level.
-- ==============================================================================

-- Step 1: Lowercase any remaining mixed-case handles (safe no-op if none exist)
UPDATE accounts
SET handle = LOWER(handle)
WHERE handle <> LOWER(handle);

-- Step 2: Remove any residual duplicate rows (safe no-op if none exist)
DELETE FROM accounts
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY platform, LOWER(handle)
        ORDER BY added_at ASC
      ) AS rn
    FROM accounts
  ) ranked
  WHERE rn > 1
);

-- Step 3: Add a CHECK constraint to enforce lowercase handles going forward.
ALTER TABLE accounts
  DROP CONSTRAINT IF EXISTS chk_accounts_handle_lowercase;

ALTER TABLE accounts
  ADD CONSTRAINT chk_accounts_handle_lowercase
  CHECK (handle = LOWER(handle));

