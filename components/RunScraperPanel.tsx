"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, Loader2, CheckCircle2, AlertCircle, X } from "lucide-react";

type Platform = "instagram" | "facebook" | "x";
type RunState = "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED";

interface PlatformRun {
  platform: Platform;
  runId: string | null;
  state: RunState;
  message: string;
  postsUpserted?: number;
  snapshotsCreated?: number;
}

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X" },
];

const POLL_MS = 4000;

interface TriggerAllResponse {
  results?: { platform: Platform; ok: boolean; runIds: string[]; message: string }[];
  error?: string;
}
interface TriggerOneResponse {
  runId?: string | null;
  message?: string;
  error?: string;
}
interface StatusResponse {
  status?: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED";
  isFinished?: boolean;
  postsUpserted?: number;
  snapshotsCreated?: number;
  message?: string;
  error?: string;
}

/**
 * Admin control to run the daily scrape: one "Run all platforms" button plus one button per
 * platform. Each run is polled until it finishes; the status endpoint ingests the data.
 */
export function RunScraperPanel({ onCompleted }: { onCompleted?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<PlatformRun[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const runsRef = useRef<PlatformRun[]>([]);
  runsRef.current = runs;

  const busy = runs.some((r) => r.state === "STARTING" || r.state === "RUNNING");

  const patchRun = useCallback((platform: Platform, patch: Partial<PlatformRun>) => {
    setRuns((prev) => prev.map((r) => (r.platform === platform ? { ...r, ...patch } : r)));
  }, []);

  const poll = useCallback(async () => {
    const active = runsRef.current.filter((r) => r.state === "RUNNING" && r.runId);
    await Promise.all(
      active.map(async (r) => {
        try {
          const res = await fetch(`/api/scraper/status?runId=${encodeURIComponent(r.runId as string)}`);
          const data: StatusResponse = await res.json();
          if (!res.ok || data.status === "FAILED") {
            patchRun(r.platform, { state: "FAILED", message: data.error || "Run failed" });
          } else if (data.status === "SUCCEEDED") {
            patchRun(r.platform, {
              state: "SUCCEEDED",
              message: data.message || "Done",
              postsUpserted: data.postsUpserted,
              snapshotsCreated: data.snapshotsCreated,
            });
          }
        } catch {
          // transient network error: keep polling
        }
      })
    );
  }, [patchRun]);

  useEffect(() => {
    if (busy && !timer.current) {
      timer.current = setInterval(poll, POLL_MS);
    }
    if (!busy && timer.current) {
      clearInterval(timer.current);
      timer.current = null;
      if (runsRef.current.some((r) => r.state === "SUCCEEDED")) {
        router.refresh();
        onCompleted?.();
      }
    }
    return () => {
      if (!busy && timer.current) {
        clearInterval(timer.current);
        timer.current = null;
      }
    };
  }, [busy, poll, router, onCompleted]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    []
  );

  async function runAll() {
    setRuns(PLATFORMS.map((p) => ({ platform: p.id, runId: null, state: "STARTING", message: "Starting..." })));
    try {
      const res = await fetch("/api/scraper/trigger-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: "discovery" }),
      });
      const data: TriggerAllResponse = await res.json();
      const results = data.results ?? [];
      setRuns(
        PLATFORMS.map((p) => {
          const r = results.find((x) => x.platform === p.id);
          if (!r) return { platform: p.id, runId: null, state: "FAILED", message: data.error || "Skipped (platform disabled)" };
          if (!r.ok || r.runIds.length === 0) return { platform: p.id, runId: null, state: "FAILED", message: r.message };
          return { platform: p.id, runId: r.runIds[0], state: "RUNNING", message: r.message };
        })
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to start runs";
      setRuns(PLATFORMS.map((p) => ({ platform: p.id, runId: null, state: "FAILED", message })));
    }
  }

  async function runOne(platform: Platform) {
    setRuns([{ platform, runId: null, state: "STARTING", message: "Starting..." }]);
    try {
      const res = await fetch("/api/scraper/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: "discovery", platform }),
      });
      const data: TriggerOneResponse = await res.json();
      if (!res.ok || !data.runId) {
        patchRun(platform, { state: "FAILED", message: data.error || "Failed to start run" });
        return;
      }
      patchRun(platform, { runId: data.runId, state: "RUNNING", message: data.message || "Running..." });
    } catch (err: unknown) {
      patchRun(platform, { state: "FAILED", message: err instanceof Error ? err.message : "Failed to start run" });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        Run Scraper
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Run daily scrape</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Collects today&apos;s posts (IST) from active accounts, up to the per-day cap in Settings.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={runAll}
              className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Run all platforms
            </button>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {PLATFORMS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={busy}
                  onClick={() => runOne(p.id)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  {p.label} only
                </button>
              ))}
            </div>

            {runs.length > 0 && (
              <ul className="mt-4 space-y-2">
                {runs.map((r) => (
                  <li key={r.platform} className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm">
                    {r.state === "SUCCEEDED" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                    ) : r.state === "FAILED" ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 text-red-600" />
                    ) : (
                      <Loader2 className="mt-0.5 h-4 w-4 animate-spin text-blue-600" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800">
                        {PLATFORMS.find((p) => p.id === r.platform)?.label}
                      </div>
                      <div className="text-xs text-slate-500 break-words">
                        {r.state === "SUCCEEDED"
                          ? `${r.postsUpserted ?? 0} posts, ${r.snapshotsCreated ?? 0} snapshots saved`
                          : r.message}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
