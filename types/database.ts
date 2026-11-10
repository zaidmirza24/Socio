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
}

export type MetricSnapshotSource = "daily_batch" | "direct_url" | "manual_refresh";

export interface MetricSnapshot {
  id: string;
  post_id: string;
  snapshot_date: string; // YYYY-MM-DD
  likes: number | null; // null if unavailable/hidden, 0 if genuinely zero
  comments: number | null;
  views: number | null; // null for images/carousels, number for videos/reels
  delta_likes: number;
  delta_comments: number;
  delta_views: number;
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
  status: AccountStatus;
  is_visible: boolean;
  last_checked_at: string | null;
  added_at: string;
  updated_at: string;
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

export interface CollectionRun {
  id: string;
  actor_run_id: string | null;
  platform: PlatformType;
  started_at: string;
  completed_at: string | null;
  status: RunStatus;
  accounts_targeted: number;
  posts_found: number;
  posts_upserted: number;
  snapshots_created: number;
  error: Record<string, unknown> | null;
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
