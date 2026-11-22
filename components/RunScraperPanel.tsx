"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { RunGainSummary } from "@/components/RunGainSummary";
import { mergeRunGains, type RunGain } from "@/lib/metrics/run-gain";
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
  /** Gain reported by each batch of this platform that was saved by this session. */
  gains: RunGain[];
  /** Batches that finished but were already saved earlier, so no gain could be measured. */
  gainUnavailable: number;
  /** Batches of this platform that failed (the others are still polled and saved). */
  failedCount: number;
  lastError: string | null;
  /** Refresh batches (post URLs) not started yet; started as running ones finish. */
  queue: string[][];
  /** Batches in the whole job, for the "x of y" progress line. */
  totalBatches: number;
  /** The last start attempt was refused because Apify's memory is full; retrying automatically. */
  waitingForMemory: boolean;
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
/** Keep in step with MAX_CONCURRENT_REFRESH_RUNS: Apify's memory limit is shared by all runs. */
const MAX_ACTIVE_RUNS = 3;

interface TriggerResponse {
  results?: { platform: Platform; ok: boolean; runIds: string[]; queuedBatches?: string[][]; message: string }[];
  error?: string;
}
interface StatusResponse {
  status?: "READY" | "RUNNING" | "SUCCEEDED" | "FAILED";
  postsUpserted?: number;
  snapshotsCreated?: number;
  gain?: RunGain | null;
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
  const [force, setForce] = useState(false);
  const [runs, setRuns] = useState<PlatformRun[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
              // Drop only this run id; other batches of the same platform keep being polled and
              // saved. The platform is marked FAILED once nothing is left to wait for.
              patchRun(r.platform, (cur) => {
                const pendingIds = cur.pendingIds.filter((id) => id !== runId);
                return {
                  ...cur,
                  pendingIds,
                  failedCount: cur.failedCount + 1,
                  lastError: data.error || "The run failed.",
                  state: pendingIds.length === 0 && cur.queue.length === 0 ? "FAILED" : cur.state,
                  message: data.error || "The run failed.",
                };
              });
            } else if (data.status === "SUCCEEDED") {
              patchRun(r.platform, (cur) => {
                const pendingIds = cur.pendingIds.filter((id) => id !== runId);
                return {
                  ...cur,
                  pendingIds,
                  postsUpserted: cur.postsUpserted + (data.postsUpserted ?? 0),
                  snapshotsCreated: cur.snapshotsCreated + (data.snapshotsCreated ?? 0),
                  gains: data.gain ? [...cur.gains, data.gain] : cur.gains,
                  gainUnavailable: cur.gainUnavailable + (data.gain ? 0 : 1),
                  state:
                    pendingIds.length === 0 && cur.queue.length === 0 && cur.state === "RUNNING"
                      ? cur.failedCount > 0
                        ? "FAILED"
                        : "SUCCEEDED"
                      : cur.state,
                  message:
                    pendingIds.length === 0 && cur.queue.length === 0 && cur.failedCount > 0
                      ? `${cur.failedCount} batch(es) failed: ${cur.lastError ?? "unknown error"}`
                      : cur.message,
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

  // Starts queued refresh batches while fewer than MAX_ACTIVE_RUNS runs are in flight. When Apify
  // reports its memory is full, the batch goes back to the front of the queue and is retried on the
  // next tick, so a full account slows the job down instead of failing it.
  const dispatching = useRef(false);
  const dispatchQueued = useCallback(async () => {
    if (dispatching.current) return;
    dispatching.current = true;
    try {
      let active = runsRef.current.reduce((n, r) => n + r.pendingIds.length, 0);
      for (const run of runsRef.current) {
        if (run.state !== "RUNNING") continue;
        // Work on a local copy: runsRef only updates on the next render.
        const local = [...run.queue];
        while (local.length > 0 && active < MAX_ACTIVE_RUNS) {
          const batch = local.shift();
          if (!batch) break;
          patchRun(run.platform, (cur) => ({ ...cur, queue: cur.queue.slice(1) }));
          try {
            const res = await fetch("/api/scraper/refresh-batch", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ platform: run.platform, urls: batch }),
            });
            const data: { runId?: string; error?: string; errorType?: string } = await res.json();
            if (res.ok && data.runId) {
              const runId = data.runId;
              active++;
              patchRun(run.platform, (cur) => ({
                ...cur,
                pendingIds: [...cur.pendingIds, runId],
                waitingForMemory: false,
              }));
            } else if (res.status === 429 || data.errorType === "MEMORY_FULL") {
              patchRun(run.platform, (cur) => ({ ...cur, queue: [batch, ...cur.queue], waitingForMemory: true }));
              return; // memory is account-wide: stop for every platform and retry next tick
            } else {
              patchRun(run.platform, (cur) => {
                const done = cur.pendingIds.length === 0 && cur.queue.length === 0;
                return {
                  ...cur,
                  failedCount: cur.failedCount + 1,
                  lastError: data.error || "A batch could not be started.",
                  state: done ? "FAILED" : cur.state,
                  message: data.error || "A batch could not be started.",
                };
              });
            }
          } catch {
            // Network error: keep the batch and try again on the next tick.
            patchRun(run.platform, (cur) => ({ ...cur, queue: [batch, ...cur.queue] }));
            return;
          }
        }
      }
    } finally {
      dispatching.current = false;
    }
  }, [patchRun]);

  // Gives up on batches that have not started (e.g. memory never freed up). Runs already started
  // keep being polled and saved; unstarted posts stay due and are picked up by the next refresh.
  const stopWaiting = useCallback(() => {
    setRuns((prev) =>
      prev.map((r) => {
        if (r.queue.length === 0) return r;
        const done = r.pendingIds.length === 0;
        return {
          ...r,
          queue: [],
          waitingForMemory: false,
          state: done ? (r.postsUpserted > 0 && r.failedCount === 0 ? "SUCCEEDED" : "FAILED") : r.state,
          message: `Stopped waiting. ${r.queue.length} batch(es) were not started; they stay due for the next refresh.`,
        };
      })
    );
  }, []);

  // Poll with a setTimeout chain, not setInterval: saving a large dataset takes longer than one
  // interval, and overlapping polls would pile up requests for the same run.
  const pollingRef = useRef(false);
  useEffect(() => {
    if (busy && !pollingRef.current) {
      pollingRef.current = true;
      const tick = async (): Promise<void> => {
        await poll();
        await dispatchQueued();
        if (!pollingRef.current) return;
        timer.current = setTimeout(() => void tick(), POLL_MS);
      };
      timer.current = setTimeout(() => void tick(), POLL_MS);
    }
    if (!busy && pollingRef.current) {
      pollingRef.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (runsRef.current.some((r) => r.state === "SUCCEEDED")) {
        router.refresh();
        onCompleted?.();
        // Show what changed straight away, even if the dialog was closed while waiting.
        setOpen(true);
      }
    }
  }, [busy, poll, dispatchQueued, router, onCompleted]);

  useEffect(
    () => () => {
      pollingRef.current = false;
      if (timer.current) clearTimeout(timer.current);
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
      gains: [],
      gainUnavailable: 0,
      failedCount: 0,
      lastError: null,
      queue: [],
      totalBatches: 0,
      waitingForMemory: false,
    });
    setRuns(targets.map(blank));

    try {
      const res = await fetch("/api/scraper/trigger-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobType: mode,
          ...(mode === "refresh" && force ? { force: true } : {}),
          ...(scope !== "all" ? { platform: scope } : {}),
        }),
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
          const queue = r.queuedBatches ?? [];
          if (r.ok && (r.runIds.length > 0 || queue.length > 0)) {
            return {
              ...blank(platform),
              state: "RUNNING",
              pendingIds: r.runIds,
              queue,
              totalBatches: r.runIds.length + queue.length,
              message: r.message,
            };
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
        <Modal size="lg" labelledBy="collect-title" onClose={() => setOpen(false)} className="p-5">
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
                {mode === "refresh" && (
                  <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-slate-600">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(e) => setForce(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300"
                    />
                    <span>
                      Refresh now, even if not due. Updates every stored post inside the age cutoff. Uses more Apify credit.
                    </span>
                  </label>
                )}
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
                      {r.state === "RUNNING" && r.totalBatches > 1 && (
                        <div className="mt-0.5 text-xs text-slate-500">
                          {r.totalBatches - r.queue.length - r.pendingIds.length} of {r.totalBatches} batches
                          saved · {r.pendingIds.length} running · {r.queue.length} waiting
                        </div>
                      )}
                      {r.state === "RUNNING" && r.waitingForMemory && (
                        <div className="mt-0.5 text-xs font-medium text-amber-700">
                          Waiting for Apify memory to free up. Retrying automatically.
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {runs.some((r) => r.queue.length > 0) && (
              <button
                type="button"
                onClick={stopWaiting}
                className="mt-3 text-xs font-medium text-slate-600 underline hover:text-slate-900"
              >
                Stop starting new batches
              </button>
            )}

            {finished && runs.some((r) => r.state === "SUCCEEDED") && (
              <RunGainSummary
                gain={mergeRunGains(runs.flatMap((r) => r.gains))}
                unavailable={runs.reduce((n, r) => n + r.gainUnavailable, 0)}
              />
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
