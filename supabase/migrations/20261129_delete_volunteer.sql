-- ==============================================================================
-- Migration: 20261129_delete_volunteer.sql
-- Description:
--   delete_volunteer(): removes a volunteer in ONE transaction, with an explicit choice about
--   what happens to the data they collected.
--
--   p_delete_data = TRUE   Volunteer, their accounts, posts and every snapshot are deleted
--                          (the existing ON DELETE CASCADE chain does the work).
--   p_delete_data = FALSE  Only the volunteer record is deleted. Their accounts are kept so all
--                          collected posts and engagement history stay on the dashboards, but
--                          they are unlinked from the volunteer and ARCHIVED so they are never
--                          scraped again (and cost nothing). accounts.volunteer_name still
--                          records whose they were.
--
--   Returns the number of accounts affected. Raises no_data_found when the volunteer is unknown.
-- Safe to re-run.
-- ==============================================================================

CREATE OR REPLACE FUNCTION delete_volunteer(p_volunteer_id UUID, p_delete_data BOOLEAN)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_accounts INTEGER;
BEGIN
  -- Lock the row so two admins deleting at once cannot interleave.
  PERFORM 1 FROM volunteers WHERE id = p_volunteer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Volunteer % not found', p_volunteer_id USING ERRCODE = 'no_data_found';
  END IF;

  SELECT count(*) INTO v_accounts FROM accounts WHERE volunteer_id = p_volunteer_id;

  IF NOT p_delete_data THEN
    UPDATE accounts
    SET volunteer_id = NULL, status = 'archived', updated_at = NOW()
    WHERE volunteer_id = p_volunteer_id;
  END IF;

  -- With p_delete_data the accounts (and their posts/snapshots) go with it via ON DELETE CASCADE.
  DELETE FROM volunteers WHERE id = p_volunteer_id;

  RETURN v_accounts;
END;
$$;

-- Only the server (service role) may call it; the API route checks the caller is an admin.
REVOKE ALL ON FUNCTION delete_volunteer(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_volunteer(UUID, BOOLEAN) TO service_role;
