"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Play, Loader2, CheckCircle2, AlertCircle, MinusCircle, X } from "lucide-react";

type Platform = "instagram" | "facebook" | "x";
type Scope = "all" | Platform;
type JobType = "discovery" | "refresh";
type RunState = "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

interface PlatformRun {
  platform: Platform;
  /** Apify runs still being polled (a refresh can be split into several batches). */
  pendingIds: string[];
  state: RunState;
  message: string;
  postsUpserted: number;
  snapshotsCreated: number;
}

const PLATFORMS: { id: Platform; label: string }[] = [
  { id: "instagram", label: "Instagram" },
  { id: "facebook", label: "Facebook" },
  { id: "x", label: "X" },
];

const SCOPES: { id: Scope; label: string }[] = [{ id: "all", label: "All platforms" }, ...PLATFORMS];

const MODES: { id: JobType; label: string; help: string }[] = [
  {
    id: "discovery",
    label: "Today's new posts",
    help: "Finds posts published today (IST) on every active account, up to the daily limit set in Settings. Run this once a day.",
  },
  {
    id: "refresh",
    label: "Refresh engagement",
    help: "Updates likes, comments and views on posts that are already stored and due for a refresh. Run this about once a week.",
  },
];

const POLL_MS = 4000;

interface TriggerResponse {
  results?: { platform: Platform; ok: boolean; runIds: string[]; message: string }[];
  error?: string;
}
interface StatusResponse {
  status?: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED";
  postsUpserted?: number;
  snapshotsCreated?: number;
  message?: string;
  error?: string;
}

const platformName = (p: Platform) => PLATFORMS.find((x) => x.id === p)?.label ?? p;

/**
 * The one place to start data collection. Pick what to collect and from where, start it, and watch
 * each platform until it is saved. Polling the status endpoint also ingests the finished data.
 */
export function RunScraperPanel({ onCompleted }: { onCompleted?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<JobType>("discovery");
  const [scope, setScope] = useState<Scope>("all");
  const [runs, setRuns] = useState<PlatformRun[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const runsRef = useRef<PlatformRun[]>([]);
  runsRef.current = runs;

  const busy = runs.some((r) => r.state === "STARTING" || r.state === "RUNNING");
  const finished = runs.length > 0 && !busy;

  const patchRun = useCallback((platform: Platform, fn: (r: PlatformRun) => PlatformRun) => {
    setRuns((prev) => prev.map((r) => (r.platform === platform ? fn(r) : r)));
  }, []);

  const poll = useCallback(async () => {
    const active = runsRef.current.filter((r) => r.state === "RUNNING");
    await Promise.all(
      active.flatMap((r) =>
        r.pendingIds.map(async (runId) => {
          try {
            const res = await fetch(`/api/scraper/status?runId=${encodeURIComponent(runId)}`);
            const data: StatusResponse = await res.json();
            if (!res.ok || data.status === "FAILED") {
              patchRun(r.platform, (cur) => ({
                ...cur,
                pendingIds: cur.pendingIds.filter((id) => id !== runId),
                state: "FAILED",
                message: data.error || "The run failed.",
              }));
            } else if (data.status === "SUCCEEDED") {
              patchRun(r.platform, (cur) => {
                const pendingIds = cur.pendingIds.filter((id) => id !== runId);
                return {
                  ...cur,
                  pendingIds,
                  postsUpserted: cur.postsUpserted + (data.postsUpserted ?? 0),
                  snapshotsCreated: cur.snapshotsCreated + (data.snapshotsCreated ?? 0),
                  state: pendingIds.length === 0 && cur.state === "RUNNING" ? "SUCCEEDED" : cur.state,
                };
              });
            }
          } catch {
            // Transient network error: keep polling.
          }
        })
      )
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
  }, [busy, poll, router, onCompleted]);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    []
  );

  async function start() {
    const targets = scope === "all" ? PLATFORMS.map((p) => p.id) : [scope];
    const blank = (platform: Platform): PlatformRun => ({
      platform,
      pendingIds: [],
      state: "STARTING",
      message: "Starting...",
      postsUpserted: 0,
      snapshotsCreated: 0,
    });
    setRuns(targets.map(blank));

    try {
      const res = await fetch("/api/scraper/trigger-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobType: mode, ...(scope !== "all" ? { platform: scope } : {}) }),
      });
      const data: TriggerResponse = await res.json();
      const results = data.results ?? [];

      setRuns(
        targets.map((platform): PlatformRun => {
          const r = results.find((x) => x.platform === platform);
          if (!r) {
            // Not returned: the platform is switched off in Settings (or the request was rejected).
            return data.error
              ? { ...blank(platform), state: "FAILED", message: data.error }
              : { ...blank(platform), state: "SKIPPED", message: "Turned off in Settings." };
          }
          if (r.ok && r.runIds.length > 0) {
            return { ...blank(platform), state: "RUNNING", pendingIds: r.runIds, message: r.message };
          }
          // Started nothing but did not fail (e.g. no posts due for refresh): a normal outcome.
          if (r.ok) {
            return { ...blank(platform), state: "SKIPPED", message: r.message };
          }
          return { ...blank(platform), state: "FAILED", message: r.message };
        })
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not start the run.";
      setRuns(targets.map((p) => ({ ...blank(p), state: "FAILED", message })));
    }
  }

  const modeInfo = MODES.find((m) => m.id === mode) ?? MODES[0];

  const segment = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-white text-blue-700 font-semibold shadow-sm" : "text-slate-600 hover:text-slate-900"
    }`;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
        <span className="hidden sm:inline">{busy ? "Collecting..." : "Collect data"}</span><span className="sm:hidden">{busy ? "..." : "Collect"}</span>
      </button>

      {open && (
        <Modal size="md" labelledBy="collect-title" onClose={() => setOpen(false)} className="p-5">
          <div>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="collect-title" className="text-base font-bold text-slate-900">
                  Collect data
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">Choose what to collect, then start.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <fieldset disabled={busy} className="mt-4 space-y-4 disabled:opacity-60">
              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-600">What to collect</div>
                <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1" role="group" aria-label="What to collect">
                  {MODES.map((m) => (
                    <button key={m.id} type="button" onClick={() => setMode(m.id)} className={segment(mode === m.id)} aria-pressed={mode === m.id}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{modeInfo.help}</p>
              </div>

              <div>
                <div className="mb-1.5 text-xs font-semibold text-slate-600">From</div>
                <div className="grid grid-cols-2 gap-1 rounded-xl sm:grid-cols-4 border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Platform">
                  {SCOPES.map((s) => (
                    <button key={s.id} type="button" onClick={() => setScope(s.id)} className={segment(scope === s.id)} aria-pressed={scope === s.id}>
                      {s.id === "all" ? "All" : s.label}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>

            <button
              type="button"
              disabled={busy}
              onClick={start}
              className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {busy ? "Collection in progress..." : finished ? "Collect again" : "Start collection"}
            </button>

            {runs.length > 0 && (
              <ul className="mt-4 space-y-2" aria-live="polite">
                {runs.map((r) => (
                  <li key={r.platform} className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm">
                    {r.state === "SUCCEEDED" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : r.state === "FAILED" ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    ) : r.state === "SKIPPED" ? (
                      <MinusCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                    ) : (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-blue-600" />
                    )}
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800">{platformName(r.platform)}</div>
                      <div className="break-words text-xs text-slate-500">
                        {r.state === "SUCCEEDED"
                          ? `Saved ${r.postsUpserted} post${r.postsUpserted === 1 ? "" : "s"} and ${r.snapshotsCreated} daily snapshot${r.snapshotsCreated === 1 ? "" : "s"}.`
                          : r.message}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {finished && (
              <p className="mt-3 text-xs text-slate-500">
                Details and costs are on the <a href="/dashboard/health" className="text-blue-600 hover:underline">Collection Runs</a> page.
              </p>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
