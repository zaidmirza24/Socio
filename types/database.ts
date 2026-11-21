export type PlatformType = "instagram" | "facebook" | "x";
export type AccountStatus = "active" | "paused" | "archived";
export type RunStatus = "started" | "success" | "failed" | "partial";
export type UserRole = "admin" | "member";

// ==========================================
// Campaign & Content Matching Types (V2)
// ==========================================

export type CampaignCaptionStatus = "active" | "archived";

export interface CampaignCaption {
  id: string;
  title: string;
  canonical_caption: string;
  normalized_caption: string;
  caption_hash: string;
  released_at: string;
  status: CampaignCaptionStatus;
  created_at: string;
  updated_at: string;
}

export type MatchTier = "tier1_exact" | "tier2_fuzzy" | "manual_approved";
export type TrackingStatus = "tracking" | "frozen" | "archived";

export interface MatchedPost {
  id: string;
  caption_id: string;
  account_id: string;
  platform: PlatformType;
  platform_post_id: string;
  post_url: string;
  normalized_caption: string;
  match_tier: MatchTier;
  match_confidence: number;
  tracking_status: TrackingStatus;
  posted_at: string;
  first_seen_at: string;
  last_seen_at: string;
  last_metrics_refresh_at?: string;
  thumbnail_url?: string | null;
}

export type MetricSnapshotSource = "daily_batch" | "direct_url" | "manual_refresh" | "weekly_refresh";

export interface MetricSnapshot {
  id: string;
  post_id: string;
  snapshot_date: string; // YYYY-MM-DD
  likes: number | null; // null if unavailable/hidden, 0 if genuinely zero
  comments: number | null;
  views: number | null; // null for images/carousels, number for videos/reels
  shares?: number | null; // null if unavailable/hidden, number for Facebook/X
  delta_likes: number;
  delta_comments: number;
  delta_views: number;
  delta_shares?: number;
  source: MetricSnapshotSource;
  fetched_at: string;
}

export type ReviewStatus = "pending" | "approved" | "rejected";

export interface ReviewQueueItem {
  id: string;
  caption_id: string;
  account_id: string;
  platform: PlatformType;
  platform_post_id: string;
  post_url: string;
  candidate_caption: string;
  similarity_score: number;
  status: ReviewStatus;
  created_at: string;
  reviewed_at?: string | null;
  reviewed_by?: string | null;
}

export interface CaptionApprovedVariant {
  id: string;
  caption_id: string;
  variant_hash: string;
  variant_caption: string;
  approved_at: string;
  approved_by?: string | null;
}

// ==========================================
// Accounts & Profiles
// ==========================================

export interface Account {
  id: string;
  platform: PlatformType;
  handle: string;
  volunteer_name: string;
  /** The volunteer (person) who owns this account. One volunteer has up to 3 accounts. */
  volunteer_id?: string | null;
  status: AccountStatus;
  is_visible: boolean;
  last_checked_at: string | null;
  added_at: string;
  updated_at: string;
}

/** Caption-match label on a stored post. Posts are never hidden or deleted because of it. */
export type PostMatchStatus = "unmatched" | "matched" | "needs_review";

export interface Volunteer {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

/** Row of the volunteer_totals SQL view (cross-platform roll-up). */
export interface VolunteerTotals {
  volunteer_id: string;
  name: string;
  accounts_count: number;
  instagram_accounts: number;
  facebook_accounts: number;
  x_accounts: number;
  posts_count: number;
  total_likes: number | null;
  total_comments: number | null;
  total_shares: number | null;
  total_views: number | null;
  last_posted_at: string | null;
}

export interface Profile {
  id: string; // references auth.users(id)
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
}

// ==========================================
// Legacy Post & Run Types (Preserved for compatibility)
// ==========================================

export interface Post {
  id: string;
  account_id: string;
  platform: PlatformType;
  platform_post_id: string;
  url: string;
  caption: string | null;
  media_type: string | null;
  posted_at: string;
  first_seen_at: string;
  last_seen_at: string;
  last_metrics_refresh_at?: string;
  thumbnail_url?: string | null;
}

export interface PostSnapshot {
  id: string;
  post_id: string;
  snapshot_date: string; // YYYY-MM-DD
  likes: number | null; // null if hidden/private, 0 if genuinely zero
  comments: number | null;
  shares: number | null;
  views: number | null;
  raw_json: Record<string, unknown> | null;
  created_at: string;
}

export interface AccountSnapshot {
  id: string;
  account_id: string;
  snapshot_date: string; // YYYY-MM-DD
  followers: number | null;
  following: number | null;
  post_count: number | null;
  created_at: string;
}

export type ScraperJobType = "discovery" | "refresh" | "direct_url";

export interface CollectionRun {
  id: string;
  actor_run_id: string | null;
  platform: PlatformType;
  provider?: string;
  job_type?: ScraperJobType;
  started_at: string;
  completed_at: string | null;
  status: RunStatus;
  accounts_targeted: number;
  posts_found: number;
  posts_upserted: number;
  posts_new?: number;
  posts_refreshed?: number;
  snapshots_created: number;
  error: Record<string, unknown> | null;
}

// ==========================================
// System Settings & Refresh Strategy Types
// ==========================================

export type ScraperRefreshStrategyMode = "30_day_cutoff" | "continuous";

export interface ScraperRefreshStrategy {
  mode: ScraperRefreshStrategyMode;
  refresh_interval_days: number;
  cutoff_days: number;
  discovery_post_limit: number;
}

export interface SystemSetting<T = unknown> {
  key: string;
  value: T;
  updated_at: string;
  updated_by?: string | null;
}

// ==========================================
// Normalized Adapters & Ingestion DTOs
// ==========================================

export type MediaType = "IMAGE" | "VIDEO" | "CAROUSEL" | "TEXT";

export interface CommonPostItem {
  platform: PlatformType;
  platform_post_id: string;
  account_handle: string;
  url: string;
  caption: string | null;
  media_type: MediaType;
  posted_at: string; // ISO 8601
  metrics: {
    likes: number | null;
    comments: number | null;
    shares?: number | null;
    views: number | null;
  };
}

export interface PlatformAdapter {
  platform: PlatformType;
  fetchRecentPosts(handles: string[], newerThan: string): Promise<CommonPostItem[]>;
  fetchPostsByUrl(urls: string[]): Promise<CommonPostItem[]>;
}

/**
 * Normalized post output produced by platform adapters before upsert.
 */
export interface NormalizedPostItem {
  platform: PlatformType;
  account_handle: string;
  platform_post_id: string;
  url: string;
  caption: string | null;
  media_type: string | null;
  posted_at: string; // ISO 8601
  thumbnail_url?: string | null;
  metrics: {
    likes: number | null;
    comments: number | null;
    shares: number | null;
    views: number | null;
  };
  raw_json: Record<string, unknown>;
}

/**
 * Normalized account metrics snapshot produced by platform adapters.
 */
export interface NormalizedAccountItem {
  platform: PlatformType;
  handle: string;
  followers: number | null;
  following: number | null;
  post_count: number | null;
}
