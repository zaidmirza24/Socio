export type PlatformType = "instagram" | "facebook";
export type AccountStatus = "active" | "paused" | "archived";
export type RunStatus = "started" | "success" | "failed" | "partial";
export type UserRole = "admin" | "member";

export interface Account {
  id: string;
  platform: PlatformType;
  handle: string;
  volunteer_name: string;
  status: AccountStatus;
  added_at: string;
  updated_at: string;
}

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

export interface Profile {
  id: string; // references auth.users(id)
  email: string;
  full_name: string | null;
  role: UserRole;
  created_at: string;
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
