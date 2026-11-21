"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Database,
  Download,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { DateRangeFilter } from "@/components/analytics/DateRangeFilter";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { formatDisplayDateTime } from "@/lib/utils";
import type { DateRangePreset } from "@/lib/supabase/queries";

type RunStatus = "started" | "success" | "failed" | "partial";

interface RunItem {
  id: string;
  actor_run_id: string | null;
  platform: string;
  job_type?: string | null;
  started_at: string;
  completed_at: string | null;
  status: RunStatus;
  accounts_targeted: number;
  posts_found: number;
  posts_upserted: number;
  snapshots_created: number;
  usage_usd?: number | string | null;
  error?: Record<string, unknown> | null;
}

interface Notice {
  tone: "ok" | "error";
  text: string;
}

const STATUS_STYLE: Record<RunStatus, string> = {
  success: "bg-emerald-100 text-emerald-800",
  started: "bg-blue-100 text-blue-800 animate-pulse",
  partial: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

const JOB_LABEL: Record<string, string> = {
  discovery: "Daily discovery",
  refresh: "Engagement refresh",
  direct_url: "Single post",
};

function toUsd(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatUsd(n: number | null): string {
  if (n === null) return "n/a";
  return `$${n.toFixed(Math.abs(n) < 1 ? 3 : 2)}`;
}

function duration(start: string, end: string | null): string {
  if (!end) return "Running...";
  const diffMs = new Date(end).getTime() - new Date(start).getTime();
  if (diffMs < 0) return "n/a";
  const sec = Math.floor(diffMs / 1000);
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function errorText(error: Record<string, unknown> | null | undefined): string {
  if (!error) return "";
  const text = JSON.stringify(error, null, 2);
  return text.length > 2000 ? `${text.slice(0, 2000)}\n… (truncated)` : text;
}

export default function SystemHealthPage() {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<DateRangePreset>("30d");
  const [platform, setPlatform] = useState<"all" | "instagram" | "facebook" | "x">("all");
  const [status, setStatus] = useState<"all" | RunStatus>("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busyRun, setBusyRun] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ range, limit: "200" });
      if (platform !== "all") params.set("platform", platform);
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/runs?${params.toString()}`);
      const data = (await res.json()) as { runs?: RunItem[]; error?: string };
      if (!res.ok) throw new Error(data.error || "Failed to fetch runs");
      setRuns(data.runs ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error fetching runs");
    } finally {
      setLoading(false);
    }
  }, [range, platform, status]);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const ingestNow = async (run: RunItem) => {
    if (!run.actor_run_id) return;
    setBusyRun(run.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/scraper/status?runId=${encodeURIComponent(run.actor_run_id)}`);
      const data = (await res.json()) as { error?: string; message?: string; status?: string; postsUpserted?: number };
      if (!res.ok) throw new Error(data.error || "Could not check this run");
      setNotice({
        tone: data.status === "FAILED" ? "error" : "ok",
        text:
          data.message ??
          (data.status === "SUCCEEDED"
            ? `Ingested ${data.postsUpserted ?? 0} posts (safe to repeat: no duplicates are created).`
            : `Run is ${data.status ?? "still running"}.`),
      });
      await fetchRuns();
    } catch (err: unknown) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Ingest failed" });
    } finally {
      setBusyRun(null);
    }
  };

  const summary = useMemo(() => {
    const total = runs.length;
    const ok = runs.filter((r) => r.status === "success").length;
    const failed = runs.filter((r) => r.status === "failed").length;
    const stuck = runs.filter((r) => r.status === "started").length;
    const spend = runs.reduce((s, r) => s + (toUsd(r.usage_usd) ?? 0), 0);
    const lastOk = runs.find((r) => r.status === "success") ?? null;
    return { total, ok, failed, stuck, spend, lastOk, rate: total > 0 ? Math.round((ok / total) * 100) : null };
  }, [runs]);

  const pill = (active: boolean) =>
    `px-2.5 py-1 rounded-md capitalize transition ${active ? "bg-slate-900 text-white font-semibold" : "text-slate-600 hover:text-slate-900"}`;

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-600" />
            System Health & Execution Logs
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Every scraper run the admin has started, with what it collected and what it cost. Start new runs from the
            buttons in the top bar.
          </p>
        </div>
        <button
          onClick={() => void fetchRuns()}
          className="inline-flex items-center gap-2 self-start rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition"
          title="Refresh logs"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {notice && (
        <div
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            notice.tone === "ok"
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
          role="status"
        >
          {notice.tone === "ok" ? (
            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          ) : (
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          )}
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNotice(null)} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-sm font-medium text-slate-500">
            Success rate <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{summary.rate === null ? "n/a" : `${summary.rate}%`}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {summary.ok} / {summary.total} runs succeeded
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-sm font-medium text-slate-500">
            Needs attention <AlertCircle className="h-5 w-5 text-red-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{summary.failed + summary.stuck}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {summary.failed} failed · {summary.stuck} not yet ingested
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-sm font-medium text-slate-500">
            Last good run <Clock className="h-5 w-5 text-blue-600" />
          </div>
          <div suppressHydrationWarning className="mt-2 text-base font-bold text-slate-900">
            {summary.lastOk ? formatDisplayDateTime(summary.lastOk.started_at) : "None in this view"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            {summary.lastOk ? `${summary.lastOk.posts_upserted} posts upserted` : "Run the scraper to collect data"}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-sm font-medium text-slate-500">
            Apify spend (shown runs) <Coins className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{formatUsd(summary.spend)}</div>
          <div className="text-xs text-slate-500 mt-0.5">Budget and forecast live in Settings</div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Database className="h-5 w-5 text-indigo-600" />
              Collection Runs
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Showing {runs.length} runs (latest 200 max). Re-ingesting a run is idempotent: it never duplicates posts.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
              {(["all", "instagram", "facebook", "x"] as const).map((p) => (
                <button key={p} onClick={() => setPlatform(p)} className={pill(platform === p)}>
                  {p === "all" ? "All" : p === "x" ? "X" : p}
                </button>
              ))}
            </div>
            <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
              {(["all", "success", "partial", "failed", "started"] as const).map((s) => (
                <button key={s} onClick={() => setStatus(s)} className={pill(status === s)}>
                  {s === "started" ? "in progress" : s}
                </button>
              ))}
            </div>
            <Suspense fallback={<div className="h-9 w-48 animate-pulse rounded-xl bg-slate-100" />}>
              <DateRangeFilter value={range} onChange={setRange} size="sm" />
            </Suspense>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="p-10 flex flex-col items-center justify-center text-slate-400">
              <Loader2 className="h-7 w-7 animate-spin text-blue-600 mb-2" />
              <span className="text-sm">Fetching run audit logs...</span>
            </div>
          ) : error ? (
            <div className="p-8 text-center text-red-600">
              <AlertCircle className="h-7 w-7 mx-auto mb-2 text-red-500" />
              <p className="text-sm font-semibold">{error}</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <Clock className="h-9 w-9 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">No runs match these filters</p>
              <p className="text-xs text-slate-400 mt-1">Try &quot;All Time&quot; or start a run from the top bar.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3.5 w-8" />
                    <th className="px-4 py-3.5">Run</th>
                    <th className="px-4 py-3.5">Platform</th>
                    <th className="px-4 py-3.5">Type</th>
                    <th className="px-4 py-3.5">Started</th>
                    <th className="px-4 py-3.5">Duration</th>
                    <th className="px-4 py-3.5">Status</th>
                    <th className="px-4 py-3.5 text-right">Targets</th>
                    <th className="px-4 py-3.5 text-right">Found</th>
                    <th className="px-4 py-3.5 text-right">Upserted</th>
                    <th className="px-4 py-3.5 text-right">Snapshots</th>
                    <th className="px-4 py-3.5 text-right">Cost</th>
                    <th className="px-4 py-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {runs.map((run) => {
                    const hasError = !!run.error && Object.keys(run.error).length > 0;
                    const isOpen = expanded === run.id;
                    const canIngest = !!run.actor_run_id && (run.status === "started" || run.status === "failed");
                    return (
                      <Fragment key={run.id}>
                        <tr className="hover:bg-slate-50/70 transition">
                          <td className="px-4 py-3.5">
                            {hasError && (
                              <button
                                onClick={() => setExpanded(isOpen ? null : run.id)}
                                className="text-slate-400 hover:text-slate-700"
                                aria-label={isOpen ? "Hide error details" : "Show error details"}
                              >
                                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                              </button>
                            )}
                          </td>
                          <td className="px-4 py-3.5 font-mono text-xs text-slate-900">
                            {run.actor_run_id || run.id.slice(0, 8)}
                          </td>
                          <td className="px-4 py-3.5">
                            <PlatformBadge platform={run.platform} />
                          </td>
                          <td className="px-4 py-3.5 text-xs text-slate-500">
                            {run.job_type ? (JOB_LABEL[run.job_type] ?? run.job_type) : "-"}
                          </td>
                          <td suppressHydrationWarning className="px-4 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                            {formatDisplayDateTime(run.started_at)}
                          </td>
                          <td className="px-4 py-3.5 text-xs font-mono text-slate-500">
                            {duration(run.started_at, run.completed_at)}
                          </td>
                          <td className="px-4 py-3.5">
                            <span
                              className={`inline-flex items-center text-xs px-2.5 py-0.5 rounded-full font-semibold ${STATUS_STYLE[run.status] ?? "bg-slate-100 text-slate-700"}`}
                            >
                              {run.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-right font-medium">{run.accounts_targeted}</td>
                          <td className="px-4 py-3.5 text-right font-medium">{run.posts_found}</td>
                          <td className="px-4 py-3.5 text-right font-medium text-slate-900">{run.posts_upserted}</td>
                          <td className="px-4 py-3.5 text-right font-semibold text-emerald-600">{run.snapshots_created}</td>
                          <td className="px-4 py-3.5 text-right font-mono text-xs">{formatUsd(toUsd(run.usage_usd))}</td>
                          <td className="px-4 py-3.5 text-right">
                            {canIngest ? (
                              <button
                                onClick={() => void ingestNow(run)}
                                disabled={busyRun === run.id}
                                className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50"
                                title="Check the Apify run and ingest its results (safe to repeat)"
                              >
                                {busyRun === run.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Download className="h-3 w-3" />
                                )}
                                {run.status === "failed" ? "Retry ingest" : "Ingest now"}
                              </button>
                            ) : (
                              <span className="text-xs text-slate-300">-</span>
                            )}
                          </td>
                        </tr>
                        {isOpen && hasError && (
                          <tr className="bg-red-50/40">
                            <td />
                            <td colSpan={12} className="px-4 py-3">
                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-red-200 bg-white p-3 text-[11px] text-red-800">
                                {errorText(run.error)}
                              </pre>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
