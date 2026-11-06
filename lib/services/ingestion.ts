import { createAdminClient } from "@/lib/supabase/admin";
import { formatDate } from "@/lib/utils";
import type { AdapterResult } from "@/lib/collectors/instagram";
import type { RunStatus } from "@/types/database";

export interface IngestionOptions {
  actorRunId?: string | null;
  targetDate?: string; // YYYY-MM-DD, defaults to today
}

export interface IngestionSummary {
  runId: string;
  status: RunStatus;
  accountsProcessed: number;
  postsFound: number;
  postsUpserted: number;
  snapshotsCreated: number;
  errors: string[];
}

/**
 * Ingests normalized platform data into Supabase Postgres.
 * Strictly idempotent: rerunning multiple times on the same date produces zero duplicate rows.
 */
export async function processIngestion(
  data: AdapterResult,
  options: IngestionOptions = {}
): Promise<IngestionSummary> {
  const supabase = createAdminClient();
  const targetDate = options.targetDate ?? formatDate();
  const startTime = new Date().toISOString();
  const errors: string[] = [];

  let postsUpserted = 0;
  let snapshotsCreated = 0;

  // 1. Initialize collection_run audit record
  const { data: runRecord, error: runInitError } = await supabase
    .from("collection_runs")
    .insert({
      actor_run_id: options.actorRunId ?? null,
      platform: "instagram",
      started_at: startTime,
      status: "started",
      accounts_targeted: data.accounts.size,
      posts_found: data.posts.length,
      posts_upserted: 0,
      snapshots_created: 0,
    })
    .select("id")
    .single();

  const runId: string = runRecord?.id ?? "local-run-" + Date.now();
  if (runInitError) {
    errors.push(`Failed to initialize collection_run: ${runInitError.message}`);
  }

  try {
    // 2. Fetch existing accounts — match handles case-insensitively so mixed-case
    //    rows already in the DB are found and don't trigger a redundant upsert.
    const handles = Array.from(data.accounts.keys()); // already lowercased by adapter
    const { data: existingAccounts, error: accountFetchError } = await supabase
      .from("accounts")
      .select("id, handle, platform")
      .eq("platform", "instagram")
      .in("handle", handles);

    if (accountFetchError) {
      throw new Error(`Failed to query accounts: ${accountFetchError.message}`);
    }

    const accountIdMap = new Map<string, string>();
    for (const acc of existingAccounts ?? []) {
      accountIdMap.set(acc.handle.toLowerCase(), acc.id);
    }

    // Do NOT auto-create accounts for unknown handles.
    // The accounts table is the authoritative list of monitored volunteers —
    // only accounts explicitly added via the UI/admin are tracked.
    // Any handle returned by the scraper that is not in accounts is silently skipped.
    // This prevents "ghost" accounts (tagged accounts, related profiles, etc.)
    // from being auto-inserted on every scraper run, which was causing the
    // accounts count to grow from 48 → 84 across runs.

    // 3. Upsert account snapshots
    for (const [handle, metrics] of Array.from(data.accounts.entries())) {
      const accountId = accountIdMap.get(handle);
      if (!accountId) continue;

      const { error: accSnapshotError } = await supabase
        .from("account_snapshots")
        .upsert(
          {
            account_id: accountId,
            snapshot_date: targetDate,
            followers: metrics.followers,
            following: metrics.following,
            post_count: metrics.post_count,
          },
          {
            onConflict: "account_id,snapshot_date",
          }
        );

      if (accSnapshotError) {
        errors.push(`Failed to upsert snapshot for account ${handle}: ${accSnapshotError.message}`);
      }
    }

    // 4. Upsert posts and create post snapshots
    for (const post of data.posts) {
      const accountId = accountIdMap.get(post.account_handle);
      if (!accountId) {
        errors.push(`Account ID not found for post handle ${post.account_handle}`);
        continue;
      }

      // Upsert post item
      const { data: upsertedPost, error: postUpsertError } = await supabase
        .from("posts")
        .upsert(
          {
            account_id: accountId,
            platform: post.platform,
            platform_post_id: post.platform_post_id,
            url: post.url,
            caption: post.caption,
            media_type: post.media_type,
            posted_at: post.posted_at,
            last_seen_at: new Date().toISOString(),
          },
          {
            onConflict: "platform,platform_post_id",
          }
        )
        .select("id")
        .single();

      if (postUpsertError || !upsertedPost) {
        errors.push(`Failed to upsert post ${post.platform_post_id}: ${postUpsertError?.message}`);
        continue;
      }

      postsUpserted++;

      // Upsert daily post snapshot
      const { error: postSnapshotError } = await supabase
        .from("post_snapshots")
        .upsert(
          {
            post_id: upsertedPost.id,
            snapshot_date: targetDate,
            likes: post.metrics.likes,
            comments: post.metrics.comments,
            shares: post.metrics.shares,
            views: post.metrics.views,
            raw_json: post.raw_json,
          },
          {
            onConflict: "post_id,snapshot_date",
          }
        );

      if (postSnapshotError) {
        errors.push(
          `Failed to record snapshot for post ${post.platform_post_id}: ${postSnapshotError.message}`
        );
      } else {
        snapshotsCreated++;
      }
    }

    // 5. Finalize collection_runs audit record
    const finalStatus: RunStatus = errors.length === 0 ? "success" : "partial";
    await supabase
      .from("collection_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: finalStatus,
        posts_upserted: postsUpserted,
        snapshots_created: snapshotsCreated,
        error: errors.length > 0 ? { messages: errors } : null,
      })
      .eq("id", runId);

    return {
      runId,
      status: finalStatus,
      accountsProcessed: accountIdMap.size,
      postsFound: data.posts.length,
      postsUpserted,
      snapshotsCreated,
      errors,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    errors.push(errorMsg);

    await supabase
      .from("collection_runs")
      .update({
        completed_at: new Date().toISOString(),
        status: "failed",
        posts_upserted: postsUpserted,
        snapshots_created: snapshotsCreated,
        error: { fatal: errorMsg, messages: errors },
      })
      .eq("id", runId);

    return {
      runId,
      status: "failed",
      accountsProcessed: 0,
      postsFound: data.posts.length,
      postsUpserted,
      snapshotsCreated,
      errors,
    };
  }
}

