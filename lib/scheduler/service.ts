/**
 * Server-side scheduler: mirrors Socio schedules as Apify Schedules, and later finds the runs those
 * schedules started so they are recorded and saved like any other run.
 *
 * Apify Schedules run with a FIXED input. The accounts are frozen when a schedule is saved; they are
 * re-saved (see `reconcileSchedules`) whenever the app notices the account list changed.
 */
import { randomUUID } from "node:crypto";
import { ScheduleActions, type ScheduleCreateOrUpdateData } from "apify-client";
import { createAdminClient } from "../supabase/admin.ts";
import { fetchAllRows } from "../supabase/paginate.ts";
import { getApifyClientAsync } from "../apify/client.ts";
import { getApifyConfig } from "../services/integrations.ts";
import { getScraperRefreshStrategy } from "../services/settings.ts";
import { ingestCompletedJob, assertPlatformEnabled } from "../services/scraper-orchestrator.ts";
import { APIFY_RUN_MEMORY_MB } from "../config/batching.ts";
import { buildDiscoveryRunInput } from "../scrapers/discovery-input.ts";
import {
  SCHEDULE_TIMEZONE,
  handleSignature,
  isFinished,
  istToday,
  orderPlatforms,
  planSchedule,
  runMatchesEntry,
  validateScheduleRequest,
  type ScheduleMode,
  type ScheduleRequest,
} from "./plan.ts";
import {
  buildProgress,
  expectedRuns,
  type DayRow,
  type ProgressTotals,
  type RecordedRun,
} from "./progress.ts";
import type { ApifyScheduleEntry, ScheduleDto, ScheduleStatus, SyncResult } from "./types.ts";
import type { PlatformType } from "../../types/database.ts";

type ScheduleAction = NonNullable<ScheduleCreateOrUpdateData["actions"]>[number];
type FrozenHandles = Partial<Record<PlatformType, string[]>>;

interface ScheduleRow {
  id: string;
  name: string;
  mode: ScheduleMode;
  start_date: string;
  end_date: string;
  run_time: string;
  gap_minutes: number;
  platforms: PlatformType[];
  status: ScheduleStatus;
  apify_schedules: ApifyScheduleEntry[];
  frozen_handles: FrozenHandles;
  post_limit: number;
  last_error: string | null;
  last_synced_at: string | null;
  created_at: string;
}

/** Most finished runs saved per sync call, so one request stays short. */
const INGEST_BATCH = 3;
/** How far back to look for runs that still need saving. */
const INGEST_LOOKBACK_MS = 48 * 60 * 60 * 1000;
/** Comparing every account list with its frozen copy reads the whole accounts table: not every poll. */
const RESYNC_CHECK_EVERY_MS = 10 * 60 * 1000;
let lastResyncCheckAt = 0;

export class ScheduleError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "ScheduleError";
    this.status = status;
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

async function loadActiveHandles(platform: PlatformType): Promise<string[]> {
  const supabase = createAdminClient();
  const rows = await fetchAllRows<{ handle: string }>((from, to) =>
    supabase
      .from("accounts")
      .select("handle")
      .eq("platform", platform)
      .eq("status", "active")
      .order("id")
      .range(from, to)
  );
  return [...new Set(rows.map((r) => r.handle.replace(/^@/, "").trim().toLowerCase()).filter(Boolean))];
}

function runActorAction(actorId: string, platform: PlatformType, input: Record<string, unknown>): ScheduleAction {
  return {
    type: ScheduleActions.RunActor,
    actorId,
    runInput: { body: JSON.stringify(input), contentType: "application/json; charset=utf-8" },
    runOptions: {
      build: "latest",
      timeoutSecs: 2 * 60 * 60,
      memoryMbytes: APIFY_RUN_MEMORY_MB[platform],
    },
  };
}

/** Frozen actor input for a platform. No date filter: a fixed date would go stale after day one. */
function frozenInput(platform: PlatformType, handles: string[], postLimit: number): Record<string, unknown> {
  return buildDiscoveryRunInput(platform, handles, { postLimit });
}

function toDto(row: ScheduleRow): ScheduleDto {
  const platforms = orderPlatforms(row.platforms);
  const times = new Map<PlatformType, string>();
  for (const e of row.apify_schedules ?? []) if (!times.has(e.platform)) times.set(e.platform, e.fireTime);
  const counts: ScheduleDto["handleCounts"] = {};
  for (const p of platforms) counts[p] = row.frozen_handles?.[p]?.length ?? 0;
  return {
    id: row.id,
    name: row.name,
    mode: row.mode,
    startDate: row.start_date,
    endDate: row.end_date,
    runTime: row.run_time,
    gapMinutes: row.gap_minutes ?? 10,
    platforms,
    status: row.status,
    handleCounts: counts,
    platformTimes: platforms.map((p) => ({ platform: p, time: times.get(p) ?? row.run_time })),
    apifyScheduleCount: row.apify_schedules?.length ?? 0,
    lastError: row.last_error,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
  };
}

async function getRow(id: string): Promise<ScheduleRow> {
  const { data, error } = await createAdminClient().from("scraper_schedules").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read the schedule: ${error.message}`);
  if (!data) throw new ScheduleError("That schedule no longer exists.", 404);
  return data as ScheduleRow;
}

/** Deletes Apify schedules, collecting failures instead of stopping at the first. */
async function deleteApifySchedules(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const client = await getApifyClientAsync();
  const failures: string[] = [];
  for (const id of ids) {
    try {
      await client.schedule(id).delete();
    } catch (err: unknown) {
      const status = (err as { statusCode?: unknown }).statusCode;
      if (status === 404) continue; // already gone
      failures.push(err instanceof Error ? err.message : String(err));
    }
  }
  return failures;
}

// ---------------------------------------------------------------------------------------------
// Create / list / pause / delete
// ---------------------------------------------------------------------------------------------

export async function listSchedules(): Promise<ScheduleDto[]> {
  const { data, error } = await createAdminClient()
    .from("scraper_schedules")
    .select("*")
    .order("start_date", { ascending: true })
    .order("run_time", { ascending: true });
  if (error) throw new Error(`Could not read schedules: ${error.message}`);
  return ((data ?? []) as ScheduleRow[]).map(toDto);
}

export async function createSchedule(
  request: ScheduleRequest & { name: string },
  userId: string
): Promise<ScheduleDto> {
  const problem = validateScheduleRequest(request);
  if (problem) throw new ScheduleError(problem);
  const platforms = orderPlatforms(request.platforms);

  for (const platform of platforms) {
    try {
      await assertPlatformEnabled(platform);
    } catch (err: unknown) {
      throw new ScheduleError(err instanceof Error ? err.message : "Platform is turned off in Settings.");
    }
  }

  const client = await getApifyClientAsync(); // throws a clear message when no token is saved
  const config = await getApifyConfig();
  const strategy = await getScraperRefreshStrategy();
  const postLimit = strategy.discovery_post_limit || 10;

  const frozen: FrozenHandles = {};
  for (const platform of platforms) {
    const handles = await loadActiveHandles(platform);
    if (handles.length === 0) {
      throw new ScheduleError(`There are no active ${platform} accounts to schedule. Add accounts first.`);
    }
    frozen[platform] = handles;
  }

  const planned = planSchedule(request);
  const id = randomUUID();
  const supabase = createAdminClient();
  const { error: insertError } = await supabase.from("scraper_schedules").insert({
    id,
    name: request.name,
    job_type: "discovery",
    mode: request.mode,
    start_date: request.startDate,
    end_date: request.endDate,
    run_time: request.runTime,
    gap_minutes: request.gapMinutes ?? 10,
    platforms,
    status: "active",
    apify_schedules: [],
    frozen_handles: frozen,
    post_limit: postLimit,
    created_by: userId,
  });
  if (insertError) throw new Error(`Could not save the schedule: ${insertError.message}`);

  const created: ApifyScheduleEntry[] = [];
  try {
    for (const [index, entry] of planned.entries()) {
      const handles = frozen[entry.platform] ?? [];
      const schedule = await client.schedules().create({
        name: `socio-${id.slice(0, 8)}-${entry.platform}-${index + 1}`,
        title: `${request.name} - ${entry.platform}`,
        description: "Created by Socio. Managed from the Scheduler page; edits made here may be overwritten.",
        cronExpression: entry.cron,
        timezone: SCHEDULE_TIMEZONE,
        isEnabled: true,
        isExclusive: true,
        notifications: { email: false },
        actions: [
          runActorAction(
            config.actors[entry.platform].discovery,
            entry.platform,
            frozenInput(entry.platform, handles, postLimit)
          ),
        ],
      });
      created.push({ ...entry, scheduleId: schedule.id });
    }
  } catch (err: unknown) {
    // All or nothing: a half-created schedule would silently skip some days or platforms.
    await deleteApifySchedules(created.map((c) => c.scheduleId));
    await supabase.from("scraper_schedules").delete().eq("id", id);
    throw new ScheduleError(
      `Apify rejected the schedule: ${err instanceof Error ? err.message : String(err)}`,
      502
    );
  }

  const { error: updateError } = await supabase
    .from("scraper_schedules")
    .update({ apify_schedules: created, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (updateError) {
    await deleteApifySchedules(created.map((c) => c.scheduleId));
    await supabase.from("scraper_schedules").delete().eq("id", id);
    throw new Error(`Could not save the schedule: ${updateError.message}`);
  }
  return toDto(await getRow(id));
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<ScheduleDto> {
  const row = await getRow(id);
  if (row.status === "completed") throw new ScheduleError("This schedule has already finished.");
  if (isFinished(row.end_date)) throw new ScheduleError("This schedule's end date has passed.");

  const client = await getApifyClientAsync();
  try {
    for (const entry of row.apify_schedules) {
      await client.schedule(entry.scheduleId).update({ isEnabled: enabled });
    }
  } catch (err: unknown) {
    throw new ScheduleError(`Apify could not update the schedule: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
  await createAdminClient()
    .from("scraper_schedules")
    .update({ status: enabled ? "active" : "paused", last_error: null, updated_at: new Date().toISOString() })
    .eq("id", id);
  return toDto(await getRow(id));
}

export async function deleteSchedule(id: string): Promise<void> {
  const row = await getRow(id);
  const failures = await deleteApifySchedules(row.apify_schedules.map((e) => e.scheduleId));
  if (failures.length > 0) {
    // Keep the row so the Apify schedules are not orphaned and still firing with nothing tracking them.
    throw new ScheduleError(`Apify could not delete every schedule (${failures[0]}). Try again.`, 502);
  }
  const { error } = await createAdminClient().from("scraper_schedules").delete().eq("id", id);
  if (error) throw new Error(`Could not delete the schedule: ${error.message}`);
}

/** Re-saves the actor input of one schedule with today's account list. */
export async function resyncSchedule(id: string): Promise<ScheduleDto> {
  const row = await getRow(id);
  if (row.status === "completed") throw new ScheduleError("This schedule has already finished.");
  await refreezeRow(row);
  return toDto(await getRow(id));
}

async function refreezeRow(row: ScheduleRow): Promise<void> {
  const client = await getApifyClientAsync();
  const config = await getApifyConfig();
  const strategy = await getScraperRefreshStrategy();
  const postLimit = strategy.discovery_post_limit || 10;

  const frozen: FrozenHandles = {};
  for (const platform of orderPlatforms(row.platforms)) {
    const handles = await loadActiveHandles(platform);
    if (handles.length === 0) {
      throw new ScheduleError(`There are no active ${platform} accounts left to schedule.`);
    }
    frozen[platform] = handles;
  }

  try {
    for (const entry of row.apify_schedules) {
      await client.schedule(entry.scheduleId).update({
        actions: [
          runActorAction(
            config.actors[entry.platform].discovery,
            entry.platform,
            frozenInput(entry.platform, frozen[entry.platform] ?? [], postLimit)
          ),
        ],
      });
    }
  } catch (err: unknown) {
    const message = `Apify could not update the saved accounts: ${err instanceof Error ? err.message : String(err)}`;
    await createAdminClient()
      .from("scraper_schedules")
      .update({ last_error: message, updated_at: new Date().toISOString() })
      .eq("id", row.id);
    throw new ScheduleError(message, 502);
  }

  await createAdminClient()
    .from("scraper_schedules")
    .update({ frozen_handles: frozen, post_limit: postLimit, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", row.id);
}

// ---------------------------------------------------------------------------------------------
// Reconcile + sync
// ---------------------------------------------------------------------------------------------

/**
 * Housekeeping that has to happen while the app is open:
 *  - a schedule whose end date has passed has its Apify schedules deleted (Apify cron has no year,
 *    so left alone they would fire again next year);
 *  - an active schedule whose accounts changed gets its frozen input re-saved.
 */
export async function reconcileSchedules(
  now: Date = new Date()
): Promise<Pick<SyncResult, "completed" | "resynced" | "errors">> {
  const out = { completed: 0, resynced: 0, errors: [] as string[] };
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("scraper_schedules")
    .select("*")
    .in("status", ["active", "paused", "error"]);
  if (error) {
    out.errors.push(`Could not read schedules: ${error.message}`);
    return out;
  }

  const checkAccounts = now.getTime() - lastResyncCheckAt >= RESYNC_CHECK_EVERY_MS;
  if (checkAccounts) lastResyncCheckAt = now.getTime();

  for (const row of (data ?? []) as ScheduleRow[]) {
    try {
      if (isFinished(row.end_date, now)) {
        const failures = await deleteApifySchedules(row.apify_schedules.map((e) => e.scheduleId));
        if (failures.length > 0) {
          out.errors.push(`${row.name}: could not delete finished Apify schedules (${failures[0]}).`);
          continue;
        }
        await supabase
          .from("scraper_schedules")
          .update({ status: "completed", updated_at: new Date().toISOString() })
          .eq("id", row.id);
        out.completed++;
        continue;
      }
      if (row.status !== "active" || !checkAccounts) continue;

      let changed = false;
      for (const platform of orderPlatforms(row.platforms)) {
        const current = await loadActiveHandles(platform);
        if (current.length > 0 && handleSignature(current) !== handleSignature(row.frozen_handles?.[platform] ?? [])) {
          changed = true;
          break;
        }
      }
      if (changed) {
        await refreezeRow(row);
        out.resynced++;
      }
    } catch (err: unknown) {
      out.errors.push(`${row.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------------------------

export interface ScheduleProgress {
  scheduleId: string;
  days: DayRow[];
  totals: ProgressTotals;
}

function errorText(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const e = error as { fatal?: unknown; messages?: unknown };
  if (typeof e.fatal === "string") return e.fatal;
  if (Array.isArray(e.messages) && typeof e.messages[0] === "string") {
    return e.messages.length > 1 ? `${e.messages[0]} (+${e.messages.length - 1} more)` : e.messages[0];
  }
  return null;
}

/** What each planned run of a schedule did: per day and platform, plus overall totals. */
export async function getScheduleProgress(id: string, now: Date = new Date()): Promise<ScheduleProgress> {
  const row = await getRow(id);
  const { data, error } = await createAdminClient()
    .from("collection_runs")
    .select("actor_run_id, platform, status, started_at, completed_at, accounts_targeted, posts_upserted, snapshots_created, error")
    .eq("schedule_id", id)
    .order("started_at", { ascending: true });
  if (error) throw new Error(`Could not read this schedule's runs: ${error.message}`);

  const recorded: RecordedRun[] = (data ?? []).map((r) => ({
    runId: (r.actor_run_id as string | null) ?? null,
    platform: r.platform as PlatformType,
    status: r.status as RecordedRun["status"],
    startedAt: r.started_at as string,
    completedAt: (r.completed_at as string | null) ?? null,
    accountsTargeted: (r.accounts_targeted as number) ?? 0,
    postsUpserted: (r.posts_upserted as number) ?? 0,
    snapshotsCreated: (r.snapshots_created as number) ?? 0,
    error: r.status === "failed" || r.status === "partial" ? errorText(r.error) : null,
  }));
  const { days, totals } = buildProgress(expectedRuns(row.apify_schedules), recorded, row.status, now);
  return { scheduleId: id, days, totals };
}

export interface AccountOutcome {
  handle: string;
  /** Posts from the run day found for this account. */
  posts: number;
}

export interface AccountDetail {
  date: string;
  platform: PlatformType;
  /** Accounts the schedule was given for this platform. */
  targeted: number;
  withPosts: number;
  withoutPosts: number;
  /** With posts first (most posts first), then those with none. Capped. */
  accounts: AccountOutcome[];
  truncated: boolean;
}

const ACCOUNT_DETAIL_CAP = 1500;

/**
 * Per-account result of one run day: of the accounts the schedule covers, which now have posts from
 * that IST day and which have none. Counted from stored posts, so it also reflects posts the account
 * made that another run saved.
 */
export async function getScheduleAccountDetail(
  id: string,
  date: string,
  platform: PlatformType
): Promise<AccountDetail> {
  const row = await getRow(id);
  const handles = row.frozen_handles?.[platform] ?? [];
  const dayStart = new Date(`${date}T00:00:00+05:30`);
  if (Number.isNaN(dayStart.getTime())) throw new ScheduleError("Invalid date.");
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  const supabase = createAdminClient();
  const accounts = await fetchAllRows<{ id: string; handle: string }>((from, to) =>
    supabase.from("accounts").select("id, handle").eq("platform", platform).order("id").range(from, to)
  );
  const handleById = new Map(accounts.map((a) => [a.id, a.handle.replace(/^@/, "").trim().toLowerCase()]));

  const posts = await fetchAllRows<{ account_id: string }>((from, to) =>
    supabase
      .from("posts")
      .select("account_id")
      .eq("platform", platform)
      .gte("posted_at", dayStart.toISOString())
      .lt("posted_at", dayEnd.toISOString())
      .order("id")
      .range(from, to)
  );
  const counts = new Map<string, number>();
  for (const p of posts) {
    const h = handleById.get(p.account_id);
    if (h) counts.set(h, (counts.get(h) ?? 0) + 1);
  }

  const outcomes: AccountOutcome[] = handles
    .map((h) => ({ handle: h, posts: counts.get(h) ?? 0 }))
    .sort((a, b) => b.posts - a.posts || a.handle.localeCompare(b.handle));
  const withPosts = outcomes.filter((o) => o.posts > 0).length;
  return {
    date,
    platform,
    targeted: outcomes.length,
    withPosts,
    withoutPosts: outcomes.length - withPosts,
    accounts: outcomes.slice(0, ACCOUNT_DETAIL_CAP),
    truncated: outcomes.length > ACCOUNT_DETAIL_CAP,
  };
}

interface Candidate {
  runId: string;
  platform: PlatformType;
  startedAt: Date;
  scheduleId: string;
  handles: string[];
}

/** Finds runs Apify started from our schedules that are not in collection_runs yet and records them. */
async function registerScheduledRuns(now: Date): Promise<{ registered: number; errors: string[] }> {
  const out = { registered: 0, errors: [] as string[] };
  const supabase = createAdminClient();

  // Include schedules that ended in the last two days: their final run may still need recording.
  const earliest = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const { data, error } = await supabase
    .from("scraper_schedules")
    .select("*")
    .in("status", ["active", "completed"])
    .gte("end_date", istToday(earliest));
  if (error) {
    out.errors.push(`Could not read schedules: ${error.message}`);
    return out;
  }
  const rows = (data ?? []) as ScheduleRow[];
  if (rows.length === 0) return out;

  const platforms = [...new Set(rows.flatMap((r) => r.apify_schedules.map((e) => e.platform)))];
  const client = await getApifyClientAsync();
  const config = await getApifyConfig();
  const candidates: Candidate[] = [];

  for (const platform of platforms) {
    try {
      const { items } = await client.actor(config.actors[platform].discovery).runs().list({ desc: true, limit: 30 });
      for (const run of items) {
        if (run.meta?.origin !== "SCHEDULER") continue;
        const startedAt = new Date(run.startedAt);
        const owner = rows.find((r) =>
          r.apify_schedules.some((e) => e.platform === platform && runMatchesEntry(startedAt, e))
        );
        if (!owner) continue; // some other schedule on this Apify account
        candidates.push({
          runId: run.id,
          platform,
          startedAt,
          scheduleId: owner.id,
          handles: owner.frozen_handles?.[platform] ?? [],
        });
      }
    } catch (err: unknown) {
      out.errors.push(`${platform}: could not list Apify runs (${err instanceof Error ? err.message : String(err)})`);
    }
  }
  if (candidates.length === 0) return out;

  const { data: known, error: knownError } = await supabase
    .from("collection_runs")
    .select("actor_run_id")
    .in("actor_run_id", candidates.map((c) => c.runId));
  if (knownError) {
    out.errors.push(`Could not check recorded runs: ${knownError.message}`);
    return out;
  }
  const have = new Set((known ?? []).map((r) => r.actor_run_id as string));

  let accountId: string | null = null;
  try {
    accountId = (await client.user("me").get())?.id ?? null;
  } catch {
    // The account id is only informational.
  }

  for (const c of candidates.filter((x) => !have.has(x.runId))) {
    const { error: insertError } = await supabase.from("collection_runs").insert({
      actor_run_id: c.runId,
      platform: c.platform,
      provider: "apify",
      job_type: "discovery",
      provider_account_id: accountId,
      schedule_id: c.scheduleId,
      started_at: c.startedAt.toISOString(),
      status: "started",
      accounts_targeted: c.handles.length,
      posts_found: 0,
      posts_upserted: 0,
      snapshots_created: 0,
      error: { scheduled: true, schedule_id: c.scheduleId, targeted_handles: c.handles },
    });
    // 23505 = another tab registered the same run first (unique actor_run_id): fine.
    if (insertError && insertError.code !== "23505") {
      out.errors.push(`Could not record run ${c.runId}: ${insertError.message}`);
    } else if (!insertError) {
      out.registered++;
    }
  }
  return out;
}

/** Saves scheduled runs that have finished at Apify. A few per call so a request stays short. */
async function ingestScheduledRuns(now: Date): Promise<{ ingested: number; errors: string[] }> {
  const out = { ingested: 0, errors: [] as string[] };
  const { data, error } = await createAdminClient()
    .from("collection_runs")
    .select("actor_run_id")
    .eq("status", "started")
    .gte("started_at", new Date(now.getTime() - INGEST_LOOKBACK_MS).toISOString())
    .not("schedule_id", "is", null)
    .order("started_at", { ascending: true })
    .limit(INGEST_BATCH);
  if (error) {
    out.errors.push(`Could not read pending scheduled runs: ${error.message}`);
    return out;
  }
  for (const row of data ?? []) {
    const runId = row.actor_run_id as string | null;
    if (!runId) continue;
    try {
      const result = await ingestCompletedJob(runId);
      if (result.state === "succeeded" && result.summary) out.ingested++;
      if (result.state === "failed") out.errors.push(`Run ${runId}: ${result.message}`);
    } catch (err: unknown) {
      out.errors.push(`Run ${runId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return out;
}

/**
 * One pass of everything that must happen while the app is open: tidy finished schedules, refresh
 * stale accounts, record runs Apify started on its own, and save the ones that have finished.
 * Safe to call as often as you like (and from several tabs): every step is idempotent.
 */
export async function syncScheduledRuns(now: Date = new Date()): Promise<SyncResult> {
  const reconciled = await reconcileSchedules(now);
  const registered = await registerScheduledRuns(now);
  const ingested = await ingestScheduledRuns(now);
  const result: SyncResult = {
    registered: registered.registered,
    ingested: ingested.ingested,
    completed: reconciled.completed,
    resynced: reconciled.resynced,
    errors: [...reconciled.errors, ...registered.errors, ...ingested.errors],
  };
  try {
    await createAdminClient()
      .from("scraper_schedules")
      .update({ last_synced_at: now.toISOString() })
      .in("status", ["active", "paused"]);
  } catch {
    // Informational only.
  }
  return result;
}
