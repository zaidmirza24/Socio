"use client";

import { useState, useEffect, useMemo, Suspense } from "react";
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock,
  Server,
  Play,
  Activity,
  RefreshCw,
  Loader2,
  Database,
} from "lucide-react";
import { TriggerScraperButton } from "@/components/TriggerScraperButton";
import { DateRangeFilter } from "@/components/analytics/DateRangeFilter";
import type { DateRangePreset } from "@/lib/supabase/queries";

interface RunItem {
  id: string;
  actor_run_id: string | null;
  platform: string;
  started_at: string;
  completed_at: string | null;
  status: "started" | "success" | "failed" | "partial";
  accounts_targeted: number;
  posts_found: number;
  posts_upserted: number;
  snapshots_created: number;
  error?: Record<string, unknown> | null;
}

export default function SystemHealthPage() {
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateRangePreset>("30d");

  const fetchRuns = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/runs");
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to fetch runs");
      }
      setRuns(data.runs || []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error fetching runs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const filteredRuns = useMemo(() => {
    if (dateFilter === "all") return runs;
    const now = new Date();
    const cutoffStr =
      dateFilter === "today"
        ? now.toISOString().slice(0, 10)
        : new Date(now.getTime() - (dateFilter === "7d" ? 7 : dateFilter === "180d" ? 180 : 30) * 86400000)
            .toISOString()
            .slice(0, 10);
    return runs.filter((r) => r.started_at && r.started_at.slice(0, 10) >= cutoffStr);
  }, [runs, dateFilter]);

  const totalRuns = filteredRuns.length;
  const successfulRuns = filteredRuns.filter((r) => r.status === "success").length;
  const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 100;

  const calculateDuration = (start: string, end: string | null) => {
    if (!end) return "Running...";
    const diffMs = new Date(end).getTime() - new Date(start).getTime();
    if (diffMs < 0) return "n/a";
    const sec = Math.floor(diffMs / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Activity className="h-6 w-6 text-blue-600" />
            System Health & Execution Logs
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time status of UI on-demand scraping and automated Supabase ingestion.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchRuns}
            className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition"
            title="Refresh logs"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <TriggerScraperButton onCompleted={fetchRuns} />
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Execution Mode</span>
            <Play className="h-5 w-5 text-blue-600" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold text-slate-900">UI On-Demand</span>
            <span className="block text-xs text-slate-500 mt-0.5">Triggered directly via Dashboard</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-blue-600 font-medium">
            <CheckCircle2 className="h-4 w-4" /> Ready to dispatch
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Ingestion Pipeline</span>
            <Database className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold text-slate-900">Live Polling & Upsert</span>
            <span className="block text-xs text-slate-500 mt-0.5">Idempotent database sync</span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
            <ShieldCheck className="h-4 w-4" /> Active & Protected
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Run Success Rate</span>
            <Clock className="h-5 w-5 text-emerald-600" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold text-slate-900">{successRate}%</span>
            <span className="block text-xs text-slate-500 mt-0.5">
              {successfulRuns} / {totalRuns} successful runs
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 font-medium">
            Audit logging: collection_runs
          </div>
        </div>
      </div>

      {/* Execution Audit Log Table */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Recent Collection Runs</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Showing {filteredRuns.length} recorded execution runs
            </p>
          </div>
          <Suspense fallback={<div className="h-9 w-48 animate-pulse bg-slate-100 rounded-xl" />}>
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} size="sm" />
          </Suspense>
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
          ) : filteredRuns.length === 0 ? (
            <div className="p-10 text-center text-slate-400">
              <Clock className="h-9 w-9 mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium text-slate-600">No scraper runs found for this time period</p>
              <p className="text-xs text-slate-400 mt-1">
                Try selecting "All Time" or click "Run Scraper Now" above to trigger a fresh run.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3.5">Run ID</th>
                    <th className="px-6 py-3.5">Platform</th>
                    <th className="px-6 py-3.5">Execution Time</th>
                    <th className="px-6 py-3.5">Duration</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5 text-right">Targets</th>
                    <th className="px-6 py-3.5 text-right">Posts Upserted</th>
                    <th className="px-6 py-3.5 text-right">Snapshots</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredRuns.map((run) => (
                    <tr key={run.id} className="hover:bg-slate-50/70 transition">
                      <td className="px-6 py-4 font-mono text-xs text-slate-900">
                        {run.actor_run_id || run.id.slice(0, 8)}
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-pink-50 text-pink-700 font-medium border border-pink-200">
                          {run.platform}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-xs text-slate-500">
                        {new Date(run.started_at).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-xs font-mono text-slate-500">
                        {calculateDuration(run.started_at, run.completed_at)}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center text-xs px-2.5 py-0.5 rounded-full font-semibold ${
                            run.status === "success"
                              ? "bg-emerald-100 text-emerald-800"
                              : run.status === "started"
                              ? "bg-blue-100 text-blue-800 animate-pulse"
                              : "bg-red-100 text-red-800"
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right font-medium">{run.accounts_targeted}</td>
                      <td className="px-6 py-4 text-right font-medium text-slate-900">
                        {run.posts_upserted}
                      </td>
                      <td className="px-6 py-4 text-right font-semibold text-emerald-600">
                        {run.snapshots_created}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
