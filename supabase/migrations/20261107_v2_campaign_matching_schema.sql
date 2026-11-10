-- ==============================================================================
-- Migration: 20261107_v2_campaign_matching_schema.sql
-- Description: Milestone 1 schema foundations for Campaign Captions, Matched Posts,
--              Metric Snapshots, Review Queue, and Approved Caption Variants.
-- ==============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. CAMPAIGN_CAPTIONS TABLE (Official canonical captions entered by admins)
CREATE TABLE IF NOT EXISTS campaign_captions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  canonical_caption TEXT NOT NULL,
  normalized_caption TEXT NOT NULL,
  caption_hash TEXT NOT NULL,
  released_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_campaign_captions_hash UNIQUE (caption_hash)
);

-- 2. ACCOUNTS TABLE UPDATES (Visibility tracking & Expanded platform support)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'is_visible'
  ) THEN
    ALTER TABLE accounts ADD COLUMN is_visible BOOLEAN NOT NULL DEFAULT true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'accounts' AND column_name = 'last_checked_at'
  ) THEN
    ALTER TABLE accounts ADD COLUMN last_checked_at TIMESTAMPTZ;
  END IF;
END $$;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_platform_check;
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS chk_accounts_platform;
ALTER TABLE accounts ADD CONSTRAINT chk_accounts_platform CHECK (platform IN ('instagram', 'facebook', 'x'));

-- Also relax platform check on legacy posts table for consistency
ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_platform_check;
ALTER TABLE posts DROP CONSTRAINT IF EXISTS chk_posts_platform;
ALTER TABLE posts ADD CONSTRAINT chk_posts_platform CHECK (platform IN ('instagram', 'facebook', 'x'));

-- 3. MATCHED_POSTS TABLE (Only posts matching registered campaign captions)
CREATE TABLE IF NOT EXISTS matched_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caption_id UUID NOT NULL REFERENCES campaign_captions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'x')),
  platform_post_id TEXT NOT NULL,
  post_url TEXT NOT NULL,
  normalized_caption TEXT NOT NULL,
  match_tier TEXT NOT NULL CHECK (match_tier IN ('tier1_exact', 'tier2_fuzzy', 'manual_approved')),
  match_confidence NUMERIC(5, 4) NOT NULL DEFAULT 1.0000 CHECK (match_confidence >= 0.0 AND match_confidence <= 1.0),
  tracking_status TEXT NOT NULL DEFAULT 'tracking' CHECK (tracking_status IN ('tracking', 'frozen', 'archived')),
  posted_at TIMESTAMPTZ NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_matched_posts_platform_post_id UNIQUE (platform, platform_post_id)
);

-- 4. METRIC_SNAPSHOTS TABLE (Daily engagement metrics & delta calculations)
CREATE TABLE IF NOT EXISTS metric_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  post_id UUID NOT NULL REFERENCES matched_posts(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  likes INTEGER,
  comments INTEGER,
  views INTEGER,
  delta_likes INTEGER NOT NULL DEFAULT 0,
  delta_comments INTEGER NOT NULL DEFAULT 0,
  delta_views INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'daily_batch' CHECK (source IN ('daily_batch', 'direct_url', 'manual_refresh')),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_metric_snapshots_post_date UNIQUE (post_id, snapshot_date)
);

-- 5. REVIEW_QUEUE TABLE (Fuzzy matches 90-99% awaiting admin diff review)
CREATE TABLE IF NOT EXISTS review_queue (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caption_id UUID NOT NULL REFERENCES campaign_captions(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram', 'facebook', 'x')),
  platform_post_id TEXT NOT NULL,
  post_url TEXT NOT NULL,
  candidate_caption TEXT NOT NULL,
  similarity_score NUMERIC(5, 4) NOT NULL CHECK (similarity_score >= 0.0 AND similarity_score <= 1.0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT uq_review_queue_platform_post_id UNIQUE (platform, platform_post_id)
);

-- 6. CAPTION_APPROVED_VARIANTS TABLE (Learned hash aliases from approved reviews)
CREATE TABLE IF NOT EXISTS caption_approved_variants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  caption_id UUID NOT NULL REFERENCES campaign_captions(id) ON DELETE CASCADE,
  variant_hash TEXT NOT NULL UNIQUE,
  variant_caption TEXT NOT NULL,
  approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL
);

-- 7. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_campaign_captions_status ON campaign_captions(status);
CREATE INDEX IF NOT EXISTS idx_campaign_captions_hash ON campaign_captions(caption_hash);
CREATE INDEX IF NOT EXISTS idx_accounts_is_visible ON accounts(is_visible);
CREATE INDEX IF NOT EXISTS idx_matched_posts_caption_id ON matched_posts(caption_id);
CREATE INDEX IF NOT EXISTS idx_matched_posts_account_id ON matched_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_matched_posts_tracking_status ON matched_posts(tracking_status);
CREATE INDEX IF NOT EXISTS idx_matched_posts_posted_at ON matched_posts(posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_post_id ON metric_snapshots(post_id);
CREATE INDEX IF NOT EXISTS idx_metric_snapshots_date ON metric_snapshots(snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_review_queue_status ON review_queue(status);
CREATE INDEX IF NOT EXISTS idx_review_queue_caption_id ON review_queue(caption_id);
CREATE INDEX IF NOT EXISTS idx_review_queue_account_id ON review_queue(account_id);
CREATE INDEX IF NOT EXISTS idx_caption_approved_variants_hash ON caption_approved_variants(variant_hash);
CREATE INDEX IF NOT EXISTS idx_caption_approved_variants_caption_id ON caption_approved_variants(caption_id);

-- 8. ROW LEVEL SECURITY (RLS)
ALTER TABLE campaign_captions ENABLE ROW LEVEL SECURITY;
ALTER TABLE matched_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE metric_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE caption_approved_variants ENABLE ROW LEVEL SECURITY;

-- Read policies for authenticated team members
CREATE POLICY "Authenticated users can read campaign_captions" ON campaign_captions
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read matched_posts" ON matched_posts
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read metric_snapshots" ON metric_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read review_queue" ON review_queue
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read caption_approved_variants" ON caption_approved_variants
  FOR SELECT TO authenticated USING (true);

-- Admin-only write policies
CREATE POLICY "Admins can manage campaign_captions" ON campaign_captions
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "Admins can manage matched_posts" ON matched_posts
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "Admins can manage metric_snapshots" ON metric_snapshots
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "Admins can manage review_queue" ON review_queue
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

CREATE POLICY "Admins can manage caption_approved_variants" ON caption_approved_variants
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
  );

-- Reload PostgREST schema cache to ensure new tables are instantly discoverable
NOTIFY pgrst, 'reload schema';


