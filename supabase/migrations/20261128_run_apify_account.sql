-- Remember which Apify account created each run.
-- A run can only be read with a token from the account that started it, so after switching
-- Apify accounts the app can say "created under a different account" instead of a raw API error.
-- Nullable: runs logged before this migration have no recorded account.
ALTER TABLE collection_runs ADD COLUMN IF NOT EXISTS provider_account_id TEXT;
