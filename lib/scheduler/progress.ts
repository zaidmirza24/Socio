/**
 * Pure progress logic: which runs a schedule is expected to produce, and what state each one is in.
 * No I/O, so it is unit-tested directly.
 */
import { FIRE_GRACE_MINUTES, parseDate, parseTime } from "./plan.ts";
import type { PlatformType } from "../../types/database.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export type RunState =
  /** Planned for later. */
  | "upcoming"
  /** Planned time just passed; Apify has not reported a run yet. */
  | "due"
  /** Planned time passed long ago and no run was ever seen. */
  | "missed"
  /** The schedule is paused, so nothing was started. */
  | "paused"
  /** Apify is crawling. */
  | "running"
  /** Apify finished; the app is saving the data. */
  | "saving"
  /** All data saved. */
  | "saved"
  /** Saved, but some rows had errors. */
  | "partial"
  | "failed";

export interface ExpectedRun {
  /** IST calendar date, YYYY-MM-DD. */
  date: string;
  platform: PlatformType;
  /** HH:MM IST. */
  fireTime: string;
}

export interface RecordedRun {
  runId: string | null;
  platform: PlatformType;
  /** collection_runs.status */
  status: "started" | "ingesting" | "success" | "partial" | "failed";
  startedAt: string;
  completedAt: string | null;
  accountsTargeted: number;
  postsUpserted: number;
  snapshotsCreated: number;
  error: string | null;
}

export interface RunRow extends ExpectedRun {
  state: RunState;
  run: RecordedRun | null;
}

export interface DayRow {
  date: string;
  runs: RunRow[];
}

export interface ProgressTotals {
  /** Planned runs in the whole schedule (days x platforms). */
  planned: number;
  saved: number;
  inProgress: number;
  failed: number;
  missed: number;
  upcoming: number;
  /** True once every planned run has ended (saved, partial, failed or missed). */
  finished: boolean;
}

function istDateOf(at: Date): string {
  return new Date(at.getTime() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Every run an Apify-schedule entry list will produce, one per platform per date. */
export function expectedRuns(
  entries: { platform: PlatformType; fireTime: string; segmentStart: string; segmentEnd: string }[]
): ExpectedRun[] {
  const out = new Map<string, ExpectedRun>();
  for (const e of entries) {
    const start = parseDate(e.segmentStart);
    const end = parseDate(e.segmentEnd);
    if (!start || !end) continue;
    for (let t = start.getTime(); t <= end.getTime(); t += DAY_MS) {
      const date = new Date(t).toISOString().slice(0, 10);
      out.set(`${date}|${e.platform}`, { date, platform: e.platform, fireTime: e.fireTime });
    }
  }
  return [...out.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.fireTime.localeCompare(b.fireTime) || a.platform.localeCompare(b.platform)
  );
}

export function classifyRun(
  expected: ExpectedRun,
  run: RecordedRun | null,
  scheduleStatus: string,
  now: Date
): RunState {
  if (run) {
    switch (run.status) {
      case "started":
        return "running";
      case "ingesting":
        return "saving";
      case "success":
        return "saved";
      case "partial":
        return "partial";
      case "failed":
        return "failed";
    }
  }
  if (scheduleStatus === "paused") return "paused";
  const minutes = parseTime(expected.fireTime) ?? 0;
  const fireAt = Date.parse(`${expected.date}T00:00:00+05:30`) + minutes * 60_000;
  if (now.getTime() < fireAt) return "upcoming";
  if (now.getTime() <= fireAt + FIRE_GRACE_MINUTES * 60_000) return "due";
  return "missed";
}

/** Joins planned runs with the runs actually recorded, grouped by day. */
export function buildProgress(
  expected: ExpectedRun[],
  recorded: RecordedRun[],
  scheduleStatus: string,
  now: Date = new Date()
): { days: DayRow[]; totals: ProgressTotals } {
  // One run per platform per IST day; if there are several, the latest wins.
  const byKey = new Map<string, RecordedRun>();
  for (const r of [...recorded].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    byKey.set(`${istDateOf(new Date(r.startedAt))}|${r.platform}`, r);
  }

  const days = new Map<string, RunRow[]>();
  const totals: ProgressTotals = {
    planned: expected.length,
    saved: 0,
    inProgress: 0,
    failed: 0,
    missed: 0,
    upcoming: 0,
    finished: false,
  };
  for (const e of expected) {
    const run = byKey.get(`${e.date}|${e.platform}`) ?? null;
    const state = classifyRun(e, run, scheduleStatus, now);
    const list = days.get(e.date) ?? [];
    list.push({ ...e, state, run });
    days.set(e.date, list);
    if (state === "saved" || state === "partial") totals.saved++;
    else if (state === "running" || state === "saving" || state === "due") totals.inProgress++;
    else if (state === "failed") totals.failed++;
    else if (state === "missed") totals.missed++;
    else totals.upcoming++; // upcoming and paused
  }
  totals.finished = expected.length > 0 && totals.inProgress === 0 && totals.upcoming === 0;
  return { days: [...days.entries()].map(([date, runs]) => ({ date, runs })), totals };
}
