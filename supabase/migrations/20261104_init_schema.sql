-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. PROFILES TABLE (Linked to Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. ACCOUNTS TABLE (Monitored social profiles)
CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  platform TEXT NOT NULL DEFAULT 'instagram' CHECK (platform IN ('instagram', 'facebook')),
  handle TEXT NOT NULL,
  volunteer_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounts_platform_handle UNIQUE (platform, handle)
);

-- 3. POSTS TABLE (Unique social posts)
CREATE TABLE IF NOT EXISTS posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  platform_post_id TEXT NOT NULL,
  url TEXT NOT NULL,
  caption TEXT,
  media_type TEXT,
  posted_at TIMESTAMPTZ NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_posts_platform_post_id UNIQUE (platform, platform_post_id)
);

-- 4. POST_SNAPSHOTS TABLE (Daily point-in-time engagement)
CREATE TABLE IF NOT EXISTS post_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  views INTEGER,
  raw_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_post_snapshots_post_date UNIQUE (post_id, snapshot_date)
);

-- 5. ACCOUNT_SNAPSHOTS TABLE (Daily account-level metrics)
CREATE TABLE IF NOT EXISTS account_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  followers INTEGER,
  following INTEGER,
  post_count INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_account_snapshots_account_date UNIQUE (account_id, snapshot_date)
);

-- 6. COLLECTION_RUNS TABLE (Ingestion audit trail)
CREATE TABLE IF NOT EXISTS collection_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_run_id TEXT,
  platform TEXT NOT NULL DEFAULT 'instagram',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed', 'partial')),
  accounts_targeted INTEGER NOT NULL DEFAULT 0,
  posts_found INTEGER NOT NULL DEFAULT 0,
  posts_upserted INTEGER NOT NULL DEFAULT 0,
  snapshots_created INTEGER NOT NULL DEFAULT 0,
  error JSONB
);

-- PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_posts_account_id ON posts(account_id);
CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_post_snapshots_date ON post_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_account_snapshots_date ON account_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_collection_runs_started ON collection_runs(started_at DESC);

-- ROW LEVEL SECURITY (RLS)
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE collection_runs ENABLE ROW LEVEL SECURITY;

-- POLICIES FOR AUTHENTICATED TEAM MEMBERS
CREATE POLICY "Authenticated users can read profiles" ON profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read accounts" ON accounts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read posts" ON posts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read post_snapshots" ON post_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read account_snapshots" ON account_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read collection_runs" ON collection_runs
  FOR SELECT TO authenticated USING (true);

-- ADMIN-ONLY WRITE POLICIES
CREATE POLICY "Admins can manage accounts" ON accounts
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );
