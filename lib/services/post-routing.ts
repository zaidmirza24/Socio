import { describeMatch, type MatchDiagnostics, type MatchResult } from "../matching/matcher.ts";

/** A caption match that is final (exact or a previously approved variant), i.e. tracked. */
export type FinalMatch = Extract<MatchResult, { matched: true; needsReview: false }>;

/**
 * What ingestion does with one post of a monitored account. Every route KEEPS the post and its
 * engagement snapshot (AGENTS.md: nothing is discarded); routes only differ in labelling and in
 * whether the post also goes to the review queue or to matched_posts.
 */
export type PostRoute = PostRouteAction & {
  /** Why the matcher decided this (absent when matching did not run). Stored on the post. */
  diagnostics?: MatchDiagnostics;
};

type PostRouteAction =
  /** Caption filter OFF: store as-is, no matching, existing label untouched. */
  | { action: "store_unlabelled" }
  /** Store and set this label (rejected / unmatched / matched via an earlier approval). */
  | { action: "label"; matchStatus: "rejected" | "unmatched" | "matched"; captionId: string | null }
  /** Fuzzy match awaiting a decision: queue (or refresh) the review item, label needs_review. */
  | { action: "queue_review"; captionId: string; confidence: number }
  /** Exact / approved-variant match: track in matched_posts + metric_snapshots, label matched. */
  | { action: "track_match"; match: FinalMatch };

export interface RoutePostInput {
  captionMatchingEnabled: boolean;
  /** review_queue status for this post, if it was ever queued. */
  existingReviewStatus: string | undefined;
  /** Runs the matcher. Only called when matching applies (filter ON, not rejected). */
  match: () => MatchResult;
}

/**
 * Pure routing decision used by lib/services/ingestion.ts (and tested directly), so the rules
 * live in one place:
 * 1. An admin-rejected post stays rejected (never re-queued: no "review resurrection").
 * 2. Caption filter OFF -> no matching at all.
 * 3. No match -> unmatched. Fuzzy -> review (or matched if an admin already approved it).
 * 4. Exact / approved variant -> tracked.
 */
export function routePost({ captionMatchingEnabled, existingReviewStatus, match }: RoutePostInput): PostRoute {
  if (existingReviewStatus === "rejected") {
    return { action: "label", matchStatus: "rejected", captionId: null };
  }
  if (!captionMatchingEnabled) {
    return { action: "store_unlabelled" };
  }

  const result = match();
  const diagnostics = describeMatch(result);
  if (!result.matched) {
    return { action: "label", matchStatus: "unmatched", captionId: null, diagnostics };
  }
  if (result.needsReview) {
    if (existingReviewStatus === "approved") {
      return { action: "label", matchStatus: "matched", captionId: result.captionId, diagnostics };
    }
    return { action: "queue_review", captionId: result.captionId, confidence: result.confidence, diagnostics };
  }
  return { action: "track_match", match: result, diagnostics };
}
