"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  CalendarClock,
  CalendarPlus,
  Info,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { ScheduleRuns } from "@/components/schedules/ScheduleRuns";
import { PageHeader } from "@/components/ui/PageHeader";
import { fetchJson } from "@/lib/fetch-json";
import {
  SCHEDULE_PLATFORMS,
  DEFAULT_GAP_MINUTES,
  MAX_GAP_MINUTES,
  istToday,
  orderPlatforms,
  validateScheduleRequest,
  type ScheduleMode,
} from "@/lib/scheduler/plan";
import type { ScheduleDto, ScheduleStatus } from "@/lib/scheduler/types";
import type { PlatformType } from "@/types/database";

const PLATFORM_LABEL: Record<PlatformType, string> = { instagram: "Instagram", facebook: "Facebook", x: "X" };

const STATUS_STYLE: Record<ScheduleStatus, string> = {
  active: "bg-emerald-100 text-emerald-800",
  paused: "bg-amber-100 text-amber-800",
  completed: "bg-slate-100 text-slate-600",
  error: "bg-red-100 text-red-800",
};

function formatDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function formatWhen(s: Pick<ScheduleDto, "mode" | "startDate" | "endDate">): string {
  return s.mode === "once" || s.startDate === s.endDate
    ? formatDay(s.startDate)
    : `${formatDay(s.startDate)} to ${formatDay(s.endDate)}`;
}

interface Props {
  initialSchedules: ScheduleDto[];
  /** Platforms switched on in Settings. */
  enabledPlatforms: PlatformType[];
  /** Set when the schedules could not be loaded (for example the migration has not been applied). */
  loadError: string | null;
}

export function SchedulesView({ initialSchedules, enabledPlatforms, loadError }: Props) {
  const router = useRouter();
  const [schedules, setSchedules] = useState<ScheduleDto[]>(initialSchedules);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(
    loadError ? { tone: "error", text: loadError } : null
  );

  const [name, setName] = useState("");
  const [mode, setMode] = useState<ScheduleMode>("once");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [runTime, setRunTime] = useState("09:00");
  const [gapText, setGapText] = useState(String(DEFAULT_GAP_MINUTES));
  const [platforms, setPlatforms] = useState<PlatformType[]>(enabledPlatforms);
  const [creating, setCreating] = useState(false);

  const today = istToday();
  const effectiveEnd = mode === "once" ? startDate : endDate;
  const gapMinutes = gapText.trim() === "" ? Number.NaN : Number(gapText);
  const request = useMemo(
    () => ({ mode, startDate, endDate: effectiveEnd, runTime, platforms: orderPlatforms(platforms), gapMinutes }),
    [mode, startDate, effectiveEnd, runTime, platforms, gapMinutes]
  );
  const problem = useMemo(
    () => (startDate && (mode === "once" || endDate) ? validateScheduleRequest(request) : null),
    [request, startDate, endDate, mode]
  );
  const ready = name.trim().length > 0 && startDate !== "" && (mode === "once" || endDate !== "") && !problem;

  const times = useMemo(() => {
    const [h, m] = runTime.split(":").map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return [];
    return orderPlatforms(platforms).map((p, i) => {
      const total = h * 60 + m + i * (Number.isFinite(gapMinutes) ? gapMinutes : 0);
      return {
        platform: p,
        time: `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`,
      };
    });
  }, [runTime, platforms, gapMinutes]);

  function togglePlatform(p: PlatformType) {
    setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  }

  async function reload() {
    const data = await fetchJson<{ schedules: ScheduleDto[] }>("/api/scraper/schedules");
    setSchedules(data.schedules);
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || creating) return;
    setCreating(true);
    setNotice(null);
    try {
      await fetchJson<{ schedule: ScheduleDto }>("/api/scraper/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          mode,
          startDate,
          endDate: effectiveEnd,
          runTime,
          platforms: orderPlatforms(platforms),
          gapMinutes,
        }),
      });
      await reload();
      setName("");
      setStartDate("");
      setEndDate("");
      setNotice({ tone: "ok", text: "Schedule saved. Apify will start the runs at the set time." });
      router.refresh();
    } catch (err: unknown) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Could not save the schedule." });
    } finally {
      setCreating(false);
    }
  }

  async function act(id: string, action: "pause" | "resume" | "refresh-accounts") {
    setBusyId(id);
    setNotice(null);
    try {
      await fetchJson(`/api/scraper/schedules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      await reload();
      if (action === "refresh-accounts") setNotice({ tone: "ok", text: "Accounts re-saved to the schedule." });
    } catch (err: unknown) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "That did not work." });
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s: ScheduleDto) {
    if (!window.confirm(`Delete "${s.name}"? Its Apify schedules are removed and no further runs will start.`)) return;
    setBusyId(s.id);
    setNotice(null);
    try {
      await fetchJson(`/api/scraper/schedules/${s.id}`, { method: "DELETE" });
      await reload();
    } catch (err: unknown) {
      setNotice({ tone: "error", text: err instanceof Error ? err.message : "Could not delete the schedule." });
    } finally {
      setBusyId(null);
    }
  }

  const input =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";
  const segment = (active: boolean) =>
    `flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      active ? "bg-white text-blue-700 font-semibold shadow-sm" : "text-slate-600 hover:text-slate-900"
    }`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Scheduler"
        description="Pick the date, the time and the platforms. Apify then starts today's-posts collection by itself at that time."
        badge={`${schedules.filter((s) => s.status === "active").length} active`}
      />

      <div className="flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-relaxed text-blue-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        <div className="space-y-1">
          <p>
            All times are IST. Platforms start one after another with the gap you set below (default{" "}
            {DEFAULT_GAP_MINUTES} minutes), so they do not use Apify&apos;s memory at the same moment.
          </p>
          <p>
            Apify keeps a fixed list of accounts for each schedule. It is re-saved from your Accounts list whenever the
            list changes while this app is open, or press &quot;Refresh accounts&quot; on a schedule.
          </p>
          <p>
            Apify starts the runs on its own. This app saves the results (posts and engagement) the next time it is open,
            checking every minute, so keep the dashboard open or open it after the run.
          </p>
        </div>
      </div>

      {notice && (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className={`flex items-start gap-2 rounded-xl border p-3 text-sm ${
            notice.tone === "error"
              ? "border-red-200 bg-red-50 text-red-800"
              : "border-emerald-200 bg-emerald-50 text-emerald-800"
          }`}
        >
          {notice.tone === "error" && <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
          <span className="break-words">{notice.text}</span>
        </div>
      )}

      <form onSubmit={create} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
          <CalendarPlus className="h-5 w-5 text-blue-600" />
          New schedule
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-600">
            Name
            <input
              className={`${input} mt-1.5 font-normal`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Launch day collection"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600">
            Time (IST)
            <input
              type="time"
              className={`${input} mt-1.5 font-normal`}
              value={runTime}
              onChange={(e) => setRunTime(e.target.value)}
              required
            />
          </label>
        </div>

        <label className="block text-xs font-semibold text-slate-600 sm:max-w-xs">
          Gap between platforms (minutes)
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_GAP_MINUTES}
            step={1}
            className={`${input} mt-1.5 font-normal`}
            value={gapText}
            onChange={(e) => setGapText(e.target.value)}
            required
          />
          <span className="mt-1 block text-xs font-normal text-slate-500">
            0 starts every platform at the same time. A longer gap leaves Apify more free memory for each run.
          </span>
        </label>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-slate-600">When</div>
          <div className="flex rounded-xl border border-slate-200 bg-slate-100 p-1" role="group" aria-label="When">
            <button type="button" className={segment(mode === "once")} aria-pressed={mode === "once"} onClick={() => setMode("once")}>
              One date
            </button>
            <button type="button" className={segment(mode === "range")} aria-pressed={mode === "range"} onClick={() => setMode("range")}>
              Every day in a date range
            </button>
          </div>
          <div className={`mt-3 grid gap-4 ${mode === "range" ? "sm:grid-cols-2" : "sm:grid-cols-1 sm:max-w-xs"}`}>
            <label className="block text-xs font-semibold text-slate-600">
              {mode === "range" ? "From" : "Date"}
              <input
                type="date"
                className={`${input} mt-1.5 font-normal`}
                value={startDate}
                min={today}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </label>
            {mode === "range" && (
              <label className="block text-xs font-semibold text-slate-600">
                To (included)
                <input
                  type="date"
                  className={`${input} mt-1.5 font-normal`}
                  value={endDate}
                  min={startDate || today}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </label>
            )}
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-slate-600">Platforms</div>
          <div className="flex flex-wrap gap-2">
            {SCHEDULE_PLATFORMS.map((p) => {
              const enabled = enabledPlatforms.includes(p);
              const on = platforms.includes(p);
              return (
                <label
                  key={p}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                    enabled ? "cursor-pointer" : "cursor-not-allowed opacity-50"
                  } ${on && enabled ? "border-blue-500 bg-blue-50 text-blue-800" : "border-slate-300 text-slate-700"}`}
                  title={enabled ? undefined : "Turned off in Settings"}
                >
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-slate-300"
                    checked={on && enabled}
                    disabled={!enabled}
                    onChange={() => togglePlatform(p)}
                  />
                  {PLATFORM_LABEL[p]}
                  {!enabled && <span className="text-xs">(off)</span>}
                </label>
              );
            })}
          </div>
        </div>

        {times.length > 0 && startDate && (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {mode === "range" ? "Every day, " : ""}
            {formatWhen({ mode, startDate, endDate: effectiveEnd || startDate })}:{" "}
            {times.map((t) => `${PLATFORM_LABEL[t.platform]} ${t.time}`).join(" · ")} IST
          </p>
        )}
        {problem && (
          <p className="text-xs text-red-600" role="alert">
            {problem}
          </p>
        )}

        <button
          type="submit"
          disabled={!ready || creating}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
          {creating ? "Saving to Apify..." : "Save schedule"}
        </button>
      </form>

      <section aria-label="Schedules" className="space-y-3">
        <h2 className="text-base font-bold text-slate-900">Schedules</h2>
        {schedules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
            Nothing scheduled yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {schedules.map((s) => {
              const busy = busyId === s.id;
              const finished = s.status === "completed";
              return (
                <li key={s.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="break-words text-sm font-bold text-slate-900">{s.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${STATUS_STYLE[s.status]}`}>
                          {s.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-600">
                        {s.mode === "range" && s.startDate !== s.endDate ? "Every day, " : ""}
                        {formatWhen(s)}
                      </p>
                      <ul className="mt-2 flex flex-wrap gap-2">
                        {s.platformTimes.map((t) => (
                          <li key={t.platform} className="flex items-center gap-1.5 text-xs text-slate-600">
                            <PlatformBadge platform={t.platform} />
                            <span className="tabular-nums">{t.time} IST</span>
                            <span className="text-slate-400">· {s.handleCounts[t.platform] ?? 0} accounts</span>
                          </li>
                        ))}
                      </ul>
                      {s.lastError && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-red-700" role="alert">
                          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                          <span className="break-words">{s.lastError}</span>
                        </p>
                      )}
                    </div>

                    {!finished && (
                      <div className="flex flex-wrap items-center gap-2">
                        {s.status === "paused" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void act(s.id, "resume")}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <Play className="h-3 w-3" /> Resume
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void act(s.id, "pause")}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <Pause className="h-3 w-3" /> Pause
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void act(s.id, "refresh-accounts")}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          <RefreshCw className="h-3 w-3" /> Refresh accounts
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void remove(s)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                        {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-500" />}
                      </div>
                    )}
                    {finished && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void remove(s)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" /> Remove
                      </button>
                    )}
                  </div>
                  <ScheduleRuns key={`${s.id}-${s.status}`} scheduleId={s.id} />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
