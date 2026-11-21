import { createAdminClient } from "../supabase/admin.ts";
import { getApifyClientAsync } from "../apify/client.ts";
import { getScraperRefreshStrategy } from "./settings.ts";

/**
 * Apify credit (USD) accounting for this platform.
 *
 * How it works:
 *   1. Every Apify run we start/ingest is logged in `collection_runs` (actor_run_id).
 *   2. After a run finishes we ask Apify for its real cost (`usageTotalUsd`) and store it.
 *   3. `apify_usage_daily` (SQL view) rolls those costs up by day / platform / job type.
 *   4. We compare the total with the Apify account's own monthly usage so you can see
 *      what share of your Apify bill Socio is responsible for.
 */

/** Assumed price per scraped item until real runs give us a measured value. Editable assumption. */
export const DEFAULT_COST_PER_ITEM_USD = 0.0023;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UsageDailyRow {
  usage_date: string; // YYYY-MM-DD (IST)
  platform: string;
  job_type: string;
  runs: number;
  runs_pending_cost: number;
  usage_usd: number | string;
  compute_units: number | string;
  posts_found: number;
  posts_upserted: number;
}

export interface UsageBudget {
  monthlyUsd: number | null;
  alertThresholdPct: number;
}

export interface UsageSummary {
  cycleStart: string; // YYYY-MM-DD
  daysElapsed: number;
  daysInCycle: number;
  spentUsd: number;
  projectedUsd: number | null;
  runs: number;
  runsPendingCost: number;
  last30DaysUsd: number;
  costPerItemUsd: number | null;
  costPerStoredPostUsd: number | null;
  byPlatform: Array<{ platform: string; usd: number; runs: number; postsFound: number }>;
  byJobType: Array<{ jobType: string; usd: number; runs: number }>;
  daily: Array<{ date: string; usd: number; runs: number }>;
  budget: {
    monthlyUsd: number | null;
    alertThresholdPct: number;
    usedPct: number | null;
    status: "none" | "ok" | "warning" | "over";
  };
}

export interface ApifyAccountUsage {
  available: boolean;
  error?: string;
  monthlyUsageUsd?: number;
  maxMonthlyUsageUsd?: number;
  cycleStart?: string;
  cycleEnd?: string;
  /** Spend on the Apify account that Socio did not log (manual runs, other projects, storage...). */
  untrackedUsd?: number;
  socioSharePct?: number | null;
}

export interface CostEstimateInput {
  activeAccounts: number;
  discoveryPostLimit: number;
  trackedPosts: number;
  refreshIntervalDays: number;
  costPerItemUsd: number;
}

export interface CostEstimate {
  discoveryItemsPerMonth: number;
  refreshItemsPerMonth: number;
  discoveryUsd: number;
  refreshUsd: number;
  totalUsd: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === "string" ? parseFloat(v) : v ?? 0;
  return Number.isFinite(n) ? n : 0;
};

export const round = (n: number, dp = 4): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** YYYY-MM-DD for the IST calendar day containing `d`. */
export function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function estimateMonthlyCost(input: CostEstimateInput): CostEstimate {
  const refreshInterval = Math.max(1, input.refreshIntervalDays);
  const discoveryItems = Math.max(0, input.activeAccounts) * Math.max(0, input.discoveryPostLimit) * 30;
  const refreshItems = Math.max(0, input.trackedPosts) * (30 / refreshInterval);
  const discoveryUsd = discoveryItems * input.costPerItemUsd;
  const refreshUsd = refreshItems * input.costPerItemUsd;
  return {
    discoveryItemsPerMonth: Math.round(discoveryItems),
    refreshItemsPerMonth: Math.round(refreshItems),
    discoveryUsd: round(discoveryUsd, 2),
    refreshUsd: round(refreshUsd, 2),
    totalUsd: round(discoveryUsd + refreshUsd, 2),
  };
}

export function summarizeUsage(
  rows: UsageDailyRow[],
  opts: { now: Date; cycleStart: Date; cycleEnd: Date | null; budget: UsageBudget }
): UsageSummary {
  const today = istDate(opts.now);
  const cycleStart = istDate(opts.cycleStart);
  const daysInCycle = opts.cycleEnd
    ? Math.max(1, Math.round((opts.cycleEnd.getTime() - opts.cycleStart.getTime()) / DAY_MS))
    : 30;
  const daysElapsed = Math.max(
    1,
    Math.floor((Date.parse(today) - Date.parse(cycleStart)) / DAY_MS) + 1
  );

  const cycleRows = rows.filter((r) => r.usage_date >= cycleStart);
  const spentUsd = cycleRows.reduce((s, r) => s + num(r.usage_usd), 0);
  const runs = cycleRows.reduce((s, r) => s + r.runs, 0);
  const runsPendingCost = cycleRows.reduce((s, r) => s + r.runs_pending_cost, 0);

  // Last 30 days (zero-filled daily series)
  const dailyMap = new Map<string, { usd: number; runs: number }>();
  for (let i = 29; i >= 0; i--) {
    dailyMap.set(istDate(new Date(opts.now.getTime() - i * DAY_MS)), { usd: 0, runs: 0 });
  }
  let last30DaysUsd = 0;
  let items30 = 0;
  let stored30 = 0;
  let usdWithItems30 = 0;
  for (const r of rows) {
    const d = dailyMap.get(r.usage_date);
    if (!d) continue;
    d.usd += num(r.usage_usd);
    d.runs += r.runs;
    last30DaysUsd += num(r.usage_usd);
    if (num(r.usage_usd) > 0) {
      usdWithItems30 += num(r.usage_usd);
      items30 += r.posts_found;
      stored30 += r.posts_upserted;
    }
  }

  const groupBy = <K extends string>(keyFn: (r: UsageDailyRow) => K) => {
    const m = new Map<K, { usd: number; runs: number; postsFound: number }>();
    for (const r of cycleRows) {
      const k = keyFn(r);
      const cur = m.get(k) ?? { usd: 0, runs: 0, postsFound: 0 };
      cur.usd += num(r.usage_usd);
      cur.runs += r.runs;
      cur.postsFound += r.posts_found;
      m.set(k, cur);
    }
    return m;
  };

  const usedPct =
    opts.budget.monthlyUsd && opts.budget.monthlyUsd > 0 ? (spentUsd / opts.budget.monthlyUsd) * 100 : null;
  let status: UsageSummary["budget"]["status"] = "none";
  if (usedPct !== null) {
    status = usedPct >= 100 ? "over" : usedPct >= opts.budget.alertThresholdPct ? "warning" : "ok";
  }

  return {
    cycleStart,
    daysElapsed,
    daysInCycle,
    spentUsd: round(spentUsd),
    // Projection needs at least 3 days of data to be meaningful
    projectedUsd: daysElapsed >= 3 && spentUsd > 0 ? round((spentUsd / daysElapsed) * daysInCycle, 2) : null,
    runs,
    runsPendingCost,
    last30DaysUsd: round(last30DaysUsd),
    costPerItemUsd: items30 > 0 ? round(usdWithItems30 / items30, 5) : null,
    costPerStoredPostUsd: stored30 > 0 ? round(usdWithItems30 / stored30, 5) : null,
    byPlatform: Array.from(groupBy((r) => r.platform).entries())
      .map(([platform, v]) => ({ platform, usd: round(v.usd), runs: v.runs, postsFound: v.postsFound }))
      .sort((a, b) => b.usd - a.usd),
    byJobType: Array.from(groupBy((r) => r.job_type).entries())
      .map(([jobType, v]) => ({ jobType, usd: round(v.usd), runs: v.runs }))
      .sort((a, b) => b.usd - a.usd),
    daily: Array.from(dailyMap.entries()).map(([date, v]) => ({ date, usd: round(v.usd), runs: v.runs })),
    budget: {
      monthlyUsd: opts.budget.monthlyUsd,
      alertThresholdPct: opts.budget.alertThresholdPct,
      usedPct: usedPct === null ? null : round(usedPct, 1),
      status,
    },
  };
}

// ---------------------------------------------------------------------------
// Budget setting (system_settings.apify_budget)
// ---------------------------------------------------------------------------

export async function getUsageBudget(): Promise<UsageBudget> {
  try {
    const { data } = await createAdminClient()
      .from("system_settings")
      .select("value")
      .eq("key", "apify_budget")
      .maybeSingle();
    const v = (data?.value ?? {}) as { monthly_budget_usd?: number | null; alert_threshold_pct?: number };
    return {
      monthlyUsd: typeof v.monthly_budget_usd === "number" && v.monthly_budget_usd > 0 ? v.monthly_budget_usd : null,
      alertThresholdPct:
        typeof v.alert_threshold_pct === "number" && v.alert_threshold_pct > 0 && v.alert_threshold_pct <= 100
          ? v.alert_threshold_pct
          : 80,
    };
  } catch {
    return { monthlyUsd: null, alertThresholdPct: 80 };
  }
}

export async function setUsageBudget(budget: UsageBudget, userId?: string): Promise<UsageBudget> {
  const { error } = await createAdminClient()
    .from("system_settings")
    .upsert(
      {
        key: "apify_budget",
        value: { monthly_budget_usd: budget.monthlyUsd, alert_threshold_pct: budget.alertThresholdPct },
        updated_at: new Date().toISOString(),
        updated_by: userId ?? null,
      },
      { onConflict: "key" }
    );
  if (error) throw new Error(`Failed to save budget: ${error.message}`);
  return budget;
}

// ---------------------------------------------------------------------------
// Pull real cost from Apify
// ---------------------------------------------------------------------------

export interface RecordUsageResult {
  recorded: boolean;
  usageUsd?: number;
  reason?: string;
}

/** Fetches the finished run's real cost from Apify and stores it on its collection_runs row. */
export async function recordRunUsage(actorRunId: string): Promise<RecordUsageResult> {
  try {
    const client = await getApifyClientAsync();
    const run = await client.run(actorRunId).get();
    if (!run) return { recorded: false, reason: "Run not found on Apify (deleted or wrong account)" };
    if (run.status === "READY" || run.status === "RUNNING") {
      return { recorded: false, reason: `Run still ${run.status}` };
    }
    if (typeof run.usageTotalUsd !== "number") {
      return { recorded: false, reason: "Apify has not published the cost for this run yet" };
    }

    const breakdown: Record<string, unknown> = { ...(run.usageUsd ?? {}) };
    if (run.chargedEventCounts) breakdown.chargedEventCounts = run.chargedEventCounts;

    const { error } = await createAdminClient()
      .from("collection_runs")
      .update({
        usage_usd: run.usageTotalUsd,
        usage_breakdown: breakdown,
        compute_units: run.stats?.computeUnits ?? null,
        usage_synced_at: new Date().toISOString(),
      })
      .eq("actor_run_id", actorRunId);
    if (error) return { recorded: false, reason: `Database error: ${error.message}` };

    return { recorded: true, usageUsd: run.usageTotalUsd };
  } catch (err: unknown) {
    return { recorded: false, reason: err instanceof Error ? err.message : "Unknown error" };
  }
}

/** Back-fills cost for any finished runs that do not have it yet. */
export async function syncPendingUsage(limit = 25): Promise<{ checked: number; recorded: number; skipped: number }> {
  const since = new Date(Date.now() - 45 * DAY_MS).toISOString();
  const { data, error } = await createAdminClient()
    .from("collection_runs")
    .select("actor_run_id")
    .not("actor_run_id", "is", null)
    .is("usage_synced_at", null)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list runs awaiting cost: ${error.message}`);

  const ids = Array.from(new Set((data ?? []).map((r) => r.actor_run_id as string)));
  let recorded = 0;
  // 3 at a time keeps us well inside Apify's rate limits
  for (let i = 0; i < ids.length; i += 3) {
    const results = await Promise.all(ids.slice(i, i + 3).map((id) => recordRunUsage(id)));
    recorded += results.filter((r) => r.recorded).length;
  }
  return { checked: ids.length, recorded, skipped: ids.length - recorded };
}

// ---------------------------------------------------------------------------
// Full report for the Settings UI
// ---------------------------------------------------------------------------

export interface UsageReport {
  generatedAt: string;
  summary: UsageSummary;
  apifyAccount: ApifyAccountUsage;
  estimate: CostEstimate & {
    basis: "measured" | "assumed";
    costPerItemUsd: number;
    activeAccounts: number;
    trackedPosts: number;
  };
}

export async function getUsageReport(): Promise<UsageReport> {
  const supabase = createAdminClient();
  const now = new Date();
  const budget = await getUsageBudget();

  // 1. Apify's own view of the account (also tells us the billing-cycle boundaries)
  let apifyAccount: ApifyAccountUsage = { available: false };
  let cycleStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  let cycleEnd: Date | null = null;
  try {
    const client = await getApifyClientAsync();
    const limits = await client.user().limits();
    if (limits) {
      cycleStart = new Date(limits.monthlyUsageCycle.startAt);
      cycleEnd = new Date(limits.monthlyUsageCycle.endAt);
      apifyAccount = {
        available: true,
        monthlyUsageUsd: round(limits.current.monthlyUsageUsd, 2),
        maxMonthlyUsageUsd: limits.limits.maxMonthlyUsageUsd,
        cycleStart: cycleStart.toISOString(),
        cycleEnd: cycleEnd.toISOString(),
      };
    }
  } catch (err: unknown) {
    apifyAccount = { available: false, error: err instanceof Error ? err.message : "Could not reach Apify" };
  }

  // 2. Our logged usage (SQL view does the aggregation)
  const sinceDate = istDate(new Date(Math.min(cycleStart.getTime(), now.getTime() - 30 * DAY_MS)));
  const { data: rows, error } = await supabase.from("apify_usage_daily").select("*").gte("usage_date", sinceDate);
  if (error) {
    throw new Error(
      `Could not read usage: ${error.message}. Run supabase/migrations/20261121_integrations_and_usage_tracking.sql first.`
    );
  }

  const summary = summarizeUsage((rows ?? []) as UsageDailyRow[], { now, cycleStart, cycleEnd, budget });

  if (apifyAccount.available && apifyAccount.monthlyUsageUsd !== undefined) {
    apifyAccount.untrackedUsd = round(Math.max(0, apifyAccount.monthlyUsageUsd - summary.spentUsd), 2);
    apifyAccount.socioSharePct =
      apifyAccount.monthlyUsageUsd > 0 ? round(Math.min(100, (summary.spentUsd / apifyAccount.monthlyUsageUsd) * 100), 1) : null;
  }

  // 3. Forecast from current settings
  const strategy = await getScraperRefreshStrategy();
  const [{ count: activeAccounts }, { count: trackedPosts }] = await Promise.all([
    supabase.from("accounts").select("*", { count: "exact", head: true }).eq("status", "active"),
    (() => {
      let q = supabase
        .from("matched_posts")
        .select("*", { count: "exact", head: true })
        .eq("tracking_status", "tracking");
      if (strategy.mode === "30_day_cutoff") {
        q = q.gte("posted_at", new Date(now.getTime() - strategy.cutoff_days * DAY_MS).toISOString());
      }
      return q;
    })(),
  ]);

  const costPerItem = summary.costPerItemUsd ?? DEFAULT_COST_PER_ITEM_USD;
  const estimate = estimateMonthlyCost({
    activeAccounts: activeAccounts ?? 0,
    discoveryPostLimit: strategy.discovery_post_limit,
    trackedPosts: trackedPosts ?? 0,
    refreshIntervalDays: strategy.refresh_interval_days,
    costPerItemUsd: costPerItem,
  });

  return {
    generatedAt: now.toISOString(),
    summary,
    apifyAccount,
    estimate: {
      ...estimate,
      basis: summary.costPerItemUsd === null ? "assumed" : "measured",
      costPerItemUsd: costPerItem,
      activeAccounts: activeAccounts ?? 0,
      trackedPosts: trackedPosts ?? 0,
    },
  };
}
