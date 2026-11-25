"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { RunGainSummary } from "@/components/RunGainSummary";
import {
  RunVolunteerPicker,
  VolunteerPickerLoading,
  useVolunteerOptions,
} from "@/components/RunVolunteerPicker";
import { mergeRunGains, type RunGain } from "@/lib/metrics/run-gain";
import { Play, Loader2, CheckCircle2, AlertCircle, MinusCircle, RotateCcw, X } from "lucide-react";

type Platform = "instagram" | "facebook" | "x";
type Scope = "all" | Platform;
type JobType = "discovery" | "refresh";
type RunState = "WAITING" | "STARTING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED";

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
  /** Refresh only: the server-side queue job this platform follows (null for discovery). */
  batchGroup: string | null;
  /** Refresh batches still waiting in the database queue for a free slot / free Apify memory. */
  queuedCount: number;
  /** Refresh batches the queue gave up on (could not be started). */
  queueFailed: number;
  /** Every run id already handed to polling, so a run that finished is never added again. */
  seenIds: string[];
  /** Batches in the whole job, for the "x of y" progress line. */
  totalBatches: number;
  /** Apify's memory is full; the queue is waiting and retries automatically. */
  waitingForMemory: boolean;
  /** Run ids that errored out; "Retry" checks them again before starting over. */
  failedIds: string[];
  /** How many times "Retry" was used; after one re-check it starts the platform again. */
  retryCount: number;
}

const STORAGE_KEY = "socio.collect.active";
/** Status checks in a row that may fail with a server/network error before the run is marked failed. */
const MAX_TRANSIENT_ERRORS = 3;

/** True when the server says the login is gone (401, or a redirect to the login page). */
function isSessionExpired(res: Response): boolean {
  if (res.status === 401) return true;
  if (!res.redirected) return false;
  try {
    return new URL(res.url).pathname.startsWith("/login");
  } catch {
    return false;
  }
}

interface SavedCollection {
  mode: JobType;
  force: boolean;
  runs: PlatformRun[];
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
  results?: {
    platform: Platform;
    ok: boolean;
    runIds: string[];
    batchGroup?: string | null;
    queuedCount?: number;
    message: string;
  }[];
  error?: string;
}
interface QueueResponse {
  groups?: {
    group: string;
    queued: number;
    starting: number;
    runIds: string[];
    failed: number;
    lastError: string | null;
  }[];
  waitingForMemory?: boolean;
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
  // Volunteers the run covers. Starts as everyone once the list has loaded.
  const volunteerState = useVolunteerOptions(open);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionInitialised, setSelectionInitialised] = useState(false);
  const [runs, setRuns] = useState<PlatformRun[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runsRef = useRef<PlatformRun[]>([]);
  runsRef.current = runs;
  // The login lapsed mid-run: polling pauses (nothing is marked failed) until the admin signs in again.
  const [sessionExpired, setSessionExpired] = useState(false);
  // Consecutive transient status-check errors per Apify run id.
  const streaks = useRef<Map<string, number>>(new Map());

  // Pick up a collection that was in progress before a reload or a re-login.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as SavedCollection;
      if (!saved || !Array.isArray(saved.runs)) return;
      const restored = saved.runs.map<PlatformRun>((r) => {
        // A platform that was still starting may or may not have launched on Apify: do not start it
        // again by itself (that could double the cost); offer Retry instead.
        if (r.state === "STARTING" || r.state === "WAITING") {
          return { ...r, state: "FAILED", message: "Interrupted before it finished starting. Use Retry to start it again." };
        }
        return r;
      });
      if (restored.length === 0) return;
      setMode(saved.mode);
      setForce(saved.force);
      setRuns(restored);
    } catch {
      // Storage unavailable or corrupt: start clean.
    }
  }, []);

  useEffect(() => {
    if (volunteerState.status === "ready" && !selectionInitialised) {
      setSelected(new Set(volunteerState.volunteers.map((v) => v.id)));
      setSelectionInitialised(true);
    }
  }, [volunteerState, selectionInitialised]);

  const totalVolunteers = volunteerState.status === "ready" ? volunteerState.volunteers.length : 0;
  const noneSelected = volunteerState.status === "ready" && selected.size === 0;

  const busy = runs.some((r) => r.state === "WAITING" || r.state === "STARTING" || r.state === "RUNNING");
  const finished = runs.length > 0 && !busy;

  const patchRun = useCallback((platform: Platform, fn: (r: PlatformRun) => PlatformRun) => {
    setRuns((prev) => prev.map((r) => (r.platform === platform ? fn(r) : r)));
  }, []);

  const poll = useCallback(async () => {
    const active = runsRef.current.filter((r) => r.state === "RUNNING");
    await Promise.all(
      active.flatMap((r) =>
        r.pendingIds.map(async (runId) => {
          // Drop only this run id; other batches of the same platform keep being polled and
          // saved. The platform is marked FAILED once nothing is left to wait for. The id is kept
          // in failedIds so "Retry" can check it again (saving a run is idempotent).
          const failRun = (message: string) => {
            streaks.current.delete(runId);
            patchRun(r.platform, (cur) => {
              const pendingIds = cur.pendingIds.filter((id) => id !== runId);
              return {
                ...cur,
                pendingIds,
                failedIds: [...cur.failedIds, runId],
                failedCount: cur.failedCount + 1,
                lastError: message,
                state: pendingIds.length === 0 && cur.queuedCount === 0 ? "FAILED" : cur.state,
                message,
              };
            });
          };
          try {
            const res = await fetch(`/api/scraper/status?runId=${encodeURIComponent(runId)}`);
            if (isSessionExpired(res)) {
              // Not a failed run: the login lapsed. Keep everything and wait for a new sign-in.
              setSessionExpired(true);
              return;
            }
            let data: StatusResponse = {};
            try {
              data = await res.json();
            } catch {
              // Non-JSON body (proxy error page): handled as a transient error below.
            }
            const transient = !res.ok && (res.status >= 500 || res.status === 429 || res.status === 408);
            if (transient || (res.ok && !data.status)) {
              const streak = (streaks.current.get(runId) ?? 0) + 1;
              streaks.current.set(runId, streak);
              if (streak >= MAX_TRANSIENT_ERRORS) {
                failRun(data.error || `The server kept returning an error (${res.status}).`);
              }
              return; // otherwise retry on the next tick
            }
            streaks.current.delete(runId);
            if (!res.ok || data.status === "FAILED") {
              failRun(data.error || "The run failed.");
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
                    pendingIds.length === 0 && cur.queuedCount === 0 && cur.state === "RUNNING"
                      ? cur.failedCount + cur.queueFailed > 0
                        ? "FAILED"
                        : "SUCCEEDED"
                      : cur.state,
                  message:
                    pendingIds.length === 0 && cur.queuedCount === 0 && cur.failedCount + cur.queueFailed > 0
                      ? `${cur.failedCount + cur.queueFailed} batch(es) failed: ${cur.lastError ?? "unknown error"}`
                      : cur.message,
                };
              });
            }
          } catch {
            // Network error: retry on the next tick, give up after a few in a row.
            const streak = (streaks.current.get(runId) ?? 0) + 1;
            streaks.current.set(runId, streak);
            if (streak >= MAX_TRANSIENT_ERRORS) failRun("Could not reach the server.");
          }
        })
      )
    );
  }, [patchRun]);

  // Follows the server-side refresh queue. Each call also asks the server to start any queued batch
  // that now fits, so the queue keeps moving even without a webhook. The queue itself lives in the
  // database: closing this dialog or the tab loses nothing.
  const syncing = useRef(false);
  const syncQueue = useCallback(async () => {
    const watched = runsRef.current.filter((r) => r.state === "RUNNING" && r.batchGroup && r.queuedCount > 0);
    if (watched.length === 0 || syncing.current) return;
    syncing.current = true;
    try {
      const res = await fetch("/api/scraper/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups: watched.map((r) => r.batchGroup) }),
      });
      if (isSessionExpired(res)) {
        setSessionExpired(true);
        return;
      }
      const data: QueueResponse = await res.json();
      if (!res.ok || !data.groups) return; // transient: try again next tick
      for (const g of data.groups) {
        const run = watched.find((r) => r.batchGroup === g.group);
        if (!run) continue;
        patchRun(run.platform, (cur) => {
          const fresh = g.runIds.filter((id) => !cur.seenIds.includes(id));
          const pendingIds = [...cur.pendingIds, ...fresh];
          const queuedCount = g.queued + g.starting;
          const failedTotal = cur.failedCount + g.failed;
          const done = pendingIds.length === 0 && queuedCount === 0;
          return {
            ...cur,
            pendingIds,
            seenIds: [...cur.seenIds, ...fresh],
            queuedCount,
            queueFailed: g.failed,
            lastError: g.lastError ?? cur.lastError,
            waitingForMemory: Boolean(data.waitingForMemory) && queuedCount > 0,
            state: done ? (failedTotal > 0 ? "FAILED" : "SUCCEEDED") : cur.state,
            message:
              done && failedTotal > 0
                ? `${failedTotal} batch(es) failed: ${g.lastError ?? cur.lastError ?? "unknown error"}`
                : cur.message,
          };
        });
      }
    } catch {
      // Network error: try again next tick.
    } finally {
      syncing.current = false;
    }
  }, [patchRun]);

  // Gives up on batches that have not started (e.g. memory never freed up). Runs already started
  // keep being polled and saved; unstarted posts stay due and are picked up by the next refresh.
  const stopWaiting = useCallback(async () => {
    const groups = runsRef.current.filter((r) => r.batchGroup && r.queuedCount > 0).map((r) => r.batchGroup);
    if (groups.length === 0) return;
    try {
      await fetch("/api/scraper/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groups, cancel: true }),
      });
    } catch {
      return; // not cancelled: the queue keeps going and the button stays available
    }
    setRuns((prev) =>
      prev.map((r) => {
        if (r.queuedCount === 0) return r;
        const done = r.pendingIds.length === 0;
        return {
          ...r,
          queuedCount: 0,
          waitingForMemory: false,
          state: done ? (r.postsUpserted > 0 ? "SUCCEEDED" : "SKIPPED") : r.state,
          message: `Stopped. ${r.queuedCount} batch(es) were not started; those posts stay due for the next refresh.`,
        };
      })
    );
  }, []);

  // Poll with a setTimeout chain, not setInterval: saving a large dataset takes longer than one
  // interval, and overlapping polls would pile up requests for the same run.
  const pollingRef = useRef(false);
  useEffect(() => {
    const shouldPoll = busy && !sessionExpired;
    if (shouldPoll && !pollingRef.current) {
      pollingRef.current = true;
      const tick = async (): Promise<void> => {
        await poll();
        await syncQueue();
        if (!pollingRef.current) return;
        timer.current = setTimeout(() => void tick(), POLL_MS);
      };
      timer.current = setTimeout(() => void tick(), POLL_MS);
    }
    if (!shouldPoll && pollingRef.current) {
      pollingRef.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!busy && runsRef.current.some((r) => r.state === "SUCCEEDED")) {
        router.refresh();
        onCompleted?.();
        // Show what changed straight away, even if the dialog was closed while waiting.
        setOpen(true);
      }
    }
  }, [busy, sessionExpired, poll, syncQueue, router, onCompleted]);

  // Remember an unfinished collection so a reload or re-login does not lose track of it.
  useEffect(() => {
    try {
      if (busy) {
        const payload: SavedCollection = { mode, force, runs };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } else {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // Storage unavailable: the run still works, it just cannot survive a reload.
    }
  }, [busy, mode, force, runs]);

  // Coming back to this tab after signing in elsewhere: carry on automatically.
  useEffect(() => {
    if (!sessionExpired) return;
    const resume = () => setSessionExpired(false);
    window.addEventListener("focus", resume);
    return () => window.removeEventListener("focus", resume);
  }, [sessionExpired]);


  useEffect(
    () => () => {
      pollingRef.current = false;
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  const blankRun = (platform: Platform, state: RunState, message: string): PlatformRun => ({
    platform,
    pendingIds: [],
    state,
    message,
    postsUpserted: 0,
    snapshotsCreated: 0,
    gains: [],
    gainUnavailable: 0,
    failedCount: 0,
    lastError: null,
    batchGroup: null,
    queuedCount: 0,
    queueFailed: 0,
    seenIds: [],
    totalBatches: 0,
    waitingForMemory: false,
    failedIds: [],
    retryCount: 0,
  });

  // Starts ONE platform. "All platforms" runs them one after another (Instagram, Facebook, X) so
  // Apify memory is never used by more than one platform at a time.
  const startPlatform = useCallback(
    async (platform: Platform) => {
      patchRun(platform, () => blankRun(platform, "STARTING", "Starting..."));
      try {
        const res = await fetch("/api/scraper/trigger-all", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobType: mode,
            platform,
            ...(mode === "refresh" && force ? { force: true } : {}),
            // Everyone selected = no filter, so volunteers added later are covered too.
            ...(volunteerState.status === "ready" && selected.size < totalVolunteers
              ? { volunteerIds: [...selected] }
              : {}),
          }),
        });
        if (isSessionExpired(res)) {
          patchRun(platform, () =>
            blankRun(platform, "FAILED", "Your session expired before this could start. Sign in again, then use Retry.")
          );
          setSessionExpired(true);
          return;
        }
        const data: TriggerResponse = await res.json();
        const r = (data.results ?? []).find((x) => x.platform === platform);
        patchRun(platform, () => {
          if (!r) {
            // Not returned: the platform is switched off in Settings (or the request was rejected).
            return data.error
              ? blankRun(platform, "FAILED", data.error)
              : blankRun(platform, "SKIPPED", "Turned off in Settings.");
          }
          const queuedCount = r.queuedCount ?? 0;
          if (r.ok && (r.runIds.length > 0 || queuedCount > 0)) {
            return {
              ...blankRun(platform, "RUNNING", r.message),
              pendingIds: r.runIds,
              seenIds: r.runIds,
              batchGroup: r.batchGroup ?? null,
              queuedCount,
              totalBatches: r.runIds.length + queuedCount,
            };
          }
          // Started nothing but did not fail (e.g. no posts due for refresh): a normal outcome.
          return r.ok ? blankRun(platform, "SKIPPED", r.message) : blankRun(platform, "FAILED", r.message);
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Could not start the run.";
        patchRun(platform, () => blankRun(platform, "FAILED", message));
      }
    },
    [mode, force, selected, totalVolunteers, volunteerState.status, patchRun]
  );

  // Retry a failed platform. First re-check the runs that errored (they may have finished on Apify
  // while the login or network was down; saving is idempotent). A second retry, or a platform that
  // never started, starts it again from scratch.
  const retryPlatform = useCallback(
    (platform: Platform) => {
      const run = runsRef.current.find((r) => r.platform === platform);
      if (!run) return;
      setSessionExpired(false);
      if (run.failedIds.length > 0 && run.retryCount === 0) {
        patchRun(platform, (cur) => ({
          ...cur,
          pendingIds: [...cur.pendingIds, ...cur.failedIds],
          failedIds: [],
          failedCount: Math.max(0, cur.failedCount - cur.failedIds.length),
          retryCount: cur.retryCount + 1,
          state: "RUNNING",
          message: "Checking the run again...",
        }));
        return;
      }
      void startPlatform(platform);
    },
    [patchRun, startPlatform]
  );

  // Starts the next waiting platform once nothing else is starting or running.
  const startingNext = useRef(false);
  useEffect(() => {
    if (startingNext.current) return;
    if (runs.some((r) => r.state === "STARTING" || r.state === "RUNNING")) return;
    const next = runs.find((r) => r.state === "WAITING");
    if (!next) return;
    startingNext.current = true;
    void startPlatform(next.platform).finally(() => {
      startingNext.current = false;
    });
  }, [runs, startPlatform]);

  function start() {
    const targets = scope === "all" ? PLATFORMS.map((p) => p.id) : [scope];
    // The first platform starts through the effect above; the rest wait their turn.
    setRuns(targets.map((p) => blankRun(p, "WAITING", "Waiting for the previous platform to finish...")));
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

              {volunteerState.status === "loading" && <VolunteerPickerLoading />}
              {volunteerState.status === "error" && (
                <p className="text-xs text-red-600" role="alert">
                  {volunteerState.message} The run will cover every volunteer.
                </p>
              )}
              {volunteerState.status === "ready" && (
                <RunVolunteerPicker volunteers={volunteerState.volunteers} selected={selected} onChange={setSelected} />
              )}
            </fieldset>

            <button
              type="button"
              disabled={busy || noneSelected}
              onClick={start}
              className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {busy ? "Collection in progress..." : finished ? "Collect again" : "Start collection"}
            </button>

            {noneSelected && !busy && (
              <p className="mt-2 text-center text-xs text-amber-700">Select at least one volunteer to start.</p>
            )}

            {sessionExpired && (
              <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900" role="alert">
                <div className="font-semibold">You were signed out. Collection is paused, not failed.</div>
                <p className="mt-0.5">
                  Sign in again in a new tab, then come back here. It carries on by itself, or press Resume.
                </p>
                <div className="mt-2 flex gap-2">
                  <a
                    href="/login"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg bg-amber-600 px-2.5 py-1 font-semibold text-white hover:bg-amber-700"
                  >
                    Sign in
                  </a>
                  <button
                    type="button"
                    onClick={() => setSessionExpired(false)}
                    className="rounded-lg border border-amber-400 px-2.5 py-1 font-semibold hover:bg-amber-100"
                  >
                    Resume
                  </button>
                </div>
              </div>
            )}

            {runs.length > 0 && (
              <ul className="mt-4 space-y-2" aria-live="polite">
                {runs.map((r) => (
                  <li key={r.platform} className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm">
                    {r.state === "SUCCEEDED" ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    ) : r.state === "FAILED" ? (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    ) : r.state === "SKIPPED" || r.state === "WAITING" ? (
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
                          {Math.max(0, r.totalBatches - r.queuedCount - r.pendingIds.length)} of {r.totalBatches} batches
                          saved · {r.pendingIds.length} running · {r.queuedCount} waiting
                        </div>
                      )}
                      {r.state === "RUNNING" && r.waitingForMemory && (
                        <div className="mt-0.5 text-xs font-medium text-amber-700">
                          Waiting for Apify memory to free up. Retrying automatically.
                        </div>
                      )}
                      {r.state === "FAILED" && (
                        <button
                          type="button"
                          onClick={() => retryPlatform(r.platform)}
                          disabled={busy && !sessionExpired}
                          className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" />
                          Retry
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {runs.some((r) => r.queuedCount > 0) && (
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
