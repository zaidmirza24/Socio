"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, MinusCircle, PauseCircle } from "lucide-react";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { fetchJson } from "@/lib/fetch-json";
import { istToday } from "@/lib/scheduler/plan";
import type { RunRow, RunState } from "@/lib/scheduler/progress";
import type { AccountDetail, ScheduleProgress } from "@/lib/scheduler/service";

const REFRESH_MS = 30_000;

const STATE: Record<RunState, { label: string; chip: string }> = {
  upcoming: { label: "Upcoming", chip: "bg-slate-100 text-slate-600" },
  due: { label: "Starting", chip: "bg-blue-100 text-blue-800 animate-pulse" },
  missed: { label: "Not started", chip: "bg-red-100 text-red-800" },
  paused: { label: "Paused", chip: "bg-amber-100 text-amber-800" },
  running: { label: "Running", chip: "bg-blue-100 text-blue-800 animate-pulse" },
  saving: { label: "Saving", chip: "bg-indigo-100 text-indigo-800 animate-pulse" },
  saved: { label: "Complete", chip: "bg-emerald-100 text-emerald-800" },
  partial: { label: "Complete, some errors", chip: "bg-amber-100 text-amber-800" },
  failed: { label: "Failed", chip: "bg-red-100 text-red-800" },
};

function StateIcon({ state }: { state: RunState }) {
  const cls = "h-4 w-4 shrink-0";
  if (state === "saved") return <CheckCircle2 className={`${cls} text-emerald-600`} />;
  if (state === "partial") return <AlertCircle className={`${cls} text-amber-600`} />;
  if (state === "failed" || state === "missed") return <AlertCircle className={`${cls} text-red-600`} />;
  if (state === "running" || state === "saving" || state === "due") return <Loader2 className={`${cls} animate-spin text-blue-600`} />;
  if (state === "paused") return <PauseCircle className={`${cls} text-amber-600`} />;
  return <Clock className={`${cls} text-slate-400`} />;
}

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function addDays(date: string, n: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10);
}

function AccountList({ scheduleId, row }: { scheduleId: string; row: RunRow }) {
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchJson<AccountDetail>(
      `/api/scraper/schedules/${scheduleId}/runs?date=${row.date}&platform=${row.platform}`
    )
      .then((d) => !cancelled && setDetail(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Could not load accounts."));
    return () => {
      cancelled = true;
    };
  }, [scheduleId, row.date, row.platform, row.run?.status]);

  if (error) return <p className="text-xs text-red-600">{error}</p>;
  if (!detail) return <p className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading accounts...</p>;

  const without = detail.accounts.filter((a) => a.posts === 0);
  const withPosts = detail.accounts.filter((a) => a.posts > 0);
  const shown = showAll ? detail.accounts : [...withPosts.slice(0, 15), ...without.slice(0, 15)];

  return (
    <div className="space-y-2 text-xs">
      <p className="text-slate-600">
        <span className="font-semibold text-emerald-700">{detail.withPosts}</span> of {detail.targeted} accounts posted on{" "}
        {formatDay(detail.date)}; <span className="font-semibold text-slate-700">{detail.withoutPosts}</span> had no post that day.
      </p>
      {shown.length > 0 && (
        <ul className="grid gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((a) => (
            <li key={a.handle} className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1">
              <span className="min-w-0 truncate text-slate-700">@{a.handle}</span>
              <span className={`shrink-0 tabular-nums ${a.posts > 0 ? "font-semibold text-emerald-700" : "text-slate-400"}`}>
                {a.posts > 0 ? `${a.posts} post${a.posts === 1 ? "" : "s"}` : "none"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {detail.accounts.length > shown.length && (
        <button type="button" onClick={() => setShowAll(true)} className="font-medium text-blue-600 hover:underline">
          Show all {detail.accounts.length} accounts
        </button>
      )}
      {detail.truncated && <p className="text-slate-500">List cut off at {detail.accounts.length} accounts.</p>}
    </div>
  );
}

function RunLine({ scheduleId, row }: { scheduleId: string; row: RunRow }) {
  const [open, setOpen] = useState(false);
  const st = STATE[row.state];
  const canExpand = row.state === "saved" || row.state === "partial" || row.state === "failed";
  const run = row.run;
  return (
    <li className="rounded-lg border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
        <StateIcon state={row.state} />
        <PlatformBadge platform={row.platform} />
        <span className="text-xs tabular-nums text-slate-500">{row.fireTime} IST</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.chip}`}>{st.label}</span>
        {run && (row.state === "saved" || row.state === "partial") && (
          <span className="text-xs text-slate-600">
            {run.postsUpserted} post{run.postsUpserted === 1 ? "" : "s"} saved · {run.accountsTargeted} accounts
          </span>
        )}
        {run && (row.state === "running" || row.state === "saving") && (
          <span className="text-xs text-slate-500">{run.accountsTargeted} accounts</span>
        )}
        {canExpand && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
          >
            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Accounts
          </button>
        )}
      </div>
      {row.state === "missed" && (
        <p className="border-t border-slate-100 px-3 py-2 text-xs text-red-700">
          Apify has not started this run. Check the schedule in the Apify Console (schedule disabled, or the account is out of credit).
          If it did run, the next sync will pick it up.
        </p>
      )}
      {run?.error && (
        <p className="break-words border-t border-slate-100 px-3 py-2 text-xs text-red-700">{run.error}</p>
      )}
      {open && (
        <div className="border-t border-slate-100 px-3 py-2">
          <AccountList scheduleId={scheduleId} row={row} />
        </div>
      )}
    </li>
  );
}

/** Live status of every planned run of one schedule: per day, per platform, then per account. */
export function ScheduleRuns({ scheduleId }: { scheduleId: string }) {
  const [progress, setProgress] = useState<ScheduleProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const alive = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<ScheduleProgress>(`/api/scraper/schedules/${scheduleId}/runs`);
      if (!alive.current) return;
      setProgress(data);
      setError(null);
    } catch (e: unknown) {
      if (alive.current) setError(e instanceof Error ? e.message : "Could not load run status.");
    }
  }, [scheduleId]);

  useEffect(() => {
    alive.current = true;
    void load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_MS);
    return () => {
      alive.current = false;
      clearInterval(t);
    };
  }, [load]);

  if (error && !progress) return <p className="mt-3 text-xs text-red-600">{error}</p>;
  if (!progress) {
    return (
      <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading run status...
      </p>
    );
  }

  const { totals, days } = progress;
  const today = istToday();
  const near = days.filter((d) => d.date >= addDays(today, -2) && d.date <= addDays(today, 1));
  // Nothing near today (schedule far ahead, or long finished): show the first or last few days.
  const fallback = days[0] && days[0].date > today ? days.slice(0, 1) : days.slice(-2);
  const visible = showAll ? days : near.length > 0 ? near : fallback;
  const done = totals.saved + totals.failed + totals.missed;
  const pct = totals.planned === 0 ? 0 : Math.round((done / totals.planned) * 100);

  return (
    <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="font-semibold text-slate-700">
            {totals.finished ? "All runs finished" : `${done} of ${totals.planned} runs finished`}
          </span>
          <span className="flex flex-wrap gap-x-3 text-slate-500">
            {totals.saved > 0 && <span className="text-emerald-700">{totals.saved} complete</span>}
            {totals.inProgress > 0 && <span className="text-blue-700">{totals.inProgress} in progress</span>}
            {totals.failed > 0 && <span className="text-red-700">{totals.failed} failed</span>}
            {totals.missed > 0 && <span className="text-red-700">{totals.missed} not started</span>}
            {totals.upcoming > 0 && <span>{totals.upcoming} upcoming</span>}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={`h-full rounded-full ${totals.failed + totals.missed > 0 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-500"><MinusCircle className="h-3.5 w-3.5" /> No runs planned.</p>
      ) : (
        visible.map((day) => (
          <div key={day.date}>
            <div className="mb-1 text-xs font-semibold text-slate-600">
              {formatDay(day.date)}
              {day.date === today && <span className="ml-1.5 rounded bg-blue-50 px-1.5 py-0.5 text-blue-700">Today</span>}
            </div>
            <ul className="space-y-1.5">
              {day.runs.map((r) => (
                <RunLine key={`${r.date}-${r.platform}`} scheduleId={scheduleId} row={r} />
              ))}
            </ul>
          </div>
        ))
      )}

      {days.length > visible.length && !showAll && (
        <button type="button" onClick={() => setShowAll(true)} className="text-xs font-medium text-blue-600 hover:underline">
          Show all {days.length} days
        </button>
      )}
      {showAll && days.length > 3 && (
        <button type="button" onClick={() => setShowAll(false)} className="text-xs font-medium text-blue-600 hover:underline">
          Show recent days only
        </button>
      )}
    </div>
  );
}
