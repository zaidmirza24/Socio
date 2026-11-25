"use client";

import React, { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Copy, Download, FileText, Search, X } from "lucide-react";
import { Notice } from "@/components/ui/Notice";
import { DayDetailDrawer, STATUS_DOT, STATUS_LABEL } from "./DayDetailDrawer";
import type { DayCoverageData } from "@/lib/supabase/matrix";
import {
  COVERAGE_PLATFORMS,
  neighbourDays,
  rowProgress,
  summarizeCoverage,
  type CoverageCount,
  type DayCell,
  type DayCellStatus,
  type DayVolunteerRow,
} from "@/lib/coverage/day-coverage";
import { platformLabel } from "@/lib/platform";
import { formatIstDateTime } from "@/lib/utils";
import type { PlatformType } from "@/types/database";

/** Volunteer rows rendered at once (up to ~500 volunteers). */
const PAGE_SIZE = 100;

const CHIP_LETTER: Record<PlatformType, string> = { instagram: "I", facebook: "F", x: "X" };
const PLATFORM_SHORT: Record<PlatformType, string> = { instagram: "IG", facebook: "FB", x: "X" };

const CHIP_STYLE: Record<DayCellStatus, string> = {
  POSTED: "bg-emerald-500 text-white border-emerald-600",
  NEEDS_REVIEW: "bg-blue-500 text-white border-blue-600",
  POSTED_OTHER: "bg-amber-300 text-amber-950 border-amber-400",
  NOT_POSTED: "bg-white text-slate-400 border-slate-300",
  NO_ACCESS: "bg-red-50 text-red-500 border-red-300",
};

type StatusFilter = "ALL" | "INCOMPLETE" | "NOT_POSTED" | "POSTED_OTHER" | "NEEDS_REVIEW" | "NO_ACCESS" | "DONE";
type SortKey = "name" | "least" | "most";

const percent = (c: CoverageCount): string => (c.expected === 0 ? "-" : `${Math.round((c.posted / c.expected) * 100)}%`);

function formatDayLabel(day: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

interface DayCoverageViewProps {
  data: DayCoverageData;
}

export function DayCoverageView({ data }: DayCoverageViewProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isNavigating, startNavigation] = useTransition();

  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<"all" | PlatformType>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<{ row: DayVolunteerRow; platform: PlatformType } | null>(null);
  const [copied, setCopied] = useState<{ captionId: string; count: number } | null>(null);

  const { captions, rows, day } = data;
  const shown: readonly PlatformType[] = platformFilter === "all" ? COVERAGE_PLATFORMS : [platformFilter];

  useEffect(() => {
    setPage(1);
  }, [search, platformFilter, statusFilter, sortKey, day]);

  // Closes the drawer when the viewed day changes.
  useEffect(() => {
    setSelected(null);
    setCopied(null);
  }, [day]);

  const goToDay = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", "matrix");
    params.set("day", next);
    params.delete("tab");
    startNavigation(() => router.replace(`/dashboard?${params.toString()}`, { scroll: false }));
  };

  const { prev, next } = neighbourDays(data.captionDays, day);

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const matches = rows.filter((row) => {
      if (!shown.some((p) => row.accounts[p])) return false;
      if (term) {
        const handles = shown.map((p) => row.accounts[p]?.handle ?? "").join(" ").toLowerCase();
        if (!row.name.toLowerCase().includes(term) && !handles.includes(term)) return false;
      }
      if (statusFilter === "ALL") return true;
      const progress = rowProgress(row, captions, shown);
      if (statusFilter === "INCOMPLETE") return progress.posted < progress.expected;
      if (statusFilter === "DONE") return progress.expected > 0 && progress.posted === progress.expected;
      return captions.some((c) => shown.some((p) => row.cells[c.id]?.[p]?.status === statusFilter));
    });

    const withProgress = matches.map((row) => ({ row, progress: rowProgress(row, captions, shown) }));
    const ratio = (c: CoverageCount) => (c.expected === 0 ? 1 : c.posted / c.expected);
    if (sortKey === "least") withProgress.sort((a, b) => ratio(a.progress) - ratio(b.progress) || a.row.name.localeCompare(b.row.name));
    else if (sortKey === "most") withProgress.sort((a, b) => ratio(b.progress) - ratio(a.progress) || a.row.name.localeCompare(b.row.name));
    return withProgress;
    // `shown` is derived from platformFilter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, captions, search, platformFilter, statusFilter, sortKey]);

  const summary = useMemo(
    () => summarizeCoverage(filteredRows.map((f) => f.row), captions, shown),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredRows, captions, platformFilter]
  );

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const copyMissing = async (captionId: string) => {
    const lines: string[] = [];
    for (const { row } of filteredRows) {
      const missing = shown.filter((p) => row.cells[captionId]?.[p]?.status === "NOT_POSTED");
      if (missing.length === 0) continue;
      lines.push(`${row.name} - ${missing.map((p) => `${PLATFORM_SHORT[p]} @${row.accounts[p]?.handle ?? ""}`).join(", ")}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied({ captionId, count: lines.length });
    } catch {
      setCopied({ captionId, count: -1 });
    }
  };

  const copiedCaption = copied ? captions.findIndex((c) => c.id === copied.captionId) + 1 : 0;

  return (
    <div className={`space-y-5 transition-opacity ${isNavigating ? "opacity-60" : ""}`}>
      {/* Day navigation */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => prev && goToDay(prev)}
            disabled={!prev}
            aria-label="Previous day with captions"
            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <input
            type="date"
            value={day}
            onChange={(e) => e.target.value && goToDay(e.target.value)}
            aria-label="Day"
            className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            type="button"
            onClick={() => next && goToDay(next)}
            disabled={!next}
            aria-label="Next day with captions"
            className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {day !== data.today && (
            <button
              type="button"
              onClick={() => goToDay(data.today)}
              className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Today
            </button>
          )}
          <span className="ml-1 text-sm font-semibold text-slate-900">{formatDayLabel(day)}</span>
        </div>
        <div className="text-xs text-slate-500">
          {captions.length} caption{captions.length === 1 ? "" : "s"} released · {data.totalVolunteers.toLocaleString("en-IN")}{" "}
          volunteers · {data.totalAccounts.toLocaleString("en-IN")} accounts
        </div>
      </div>

      {!data.matchingEnabled && (
        <Notice tone="info">
          The caption filter is OFF, so posts are collected but not matched to captions. Anything an account posted shows as
          &ldquo;posted, but no caption matched&rdquo;. Turn the filter on in Settings to get matches.
        </Notice>
      )}

      {captions.length === 0 ? (
        <div className="rounded-xl border border-slate-200/90 bg-white p-16 text-center text-slate-500 shadow-xs">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-slate-100">
            <FileText className="h-6 w-6" />
          </div>
          <h3 className="text-sm font-semibold text-slate-800">No captions were released on this day</h3>
          <p className="mx-auto mt-1 max-w-sm text-xs">
            Pick another day{prev || next ? ", or jump to the nearest day that has captions" : ""}, or add captions in the
            caption registry.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            {prev && (
              <button type="button" onClick={() => goToDay(prev)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                &larr; {formatDayLabel(prev)}
              </button>
            )}
            {next && (
              <button type="button" onClick={() => goToDay(next)} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                {formatDayLabel(next)} &rarr;
              </button>
            )}
            <Link href="/dashboard/captions" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700">
              Add captions
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Coverage header: per platform + status counts, following the filters below */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs lg:col-span-1">
              <div className="mb-3 flex items-baseline justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Coverage</span>
                <span className="text-xs text-slate-500">
                  {summary.overall.posted.toLocaleString("en-IN")} of {summary.overall.expected.toLocaleString("en-IN")} posts
                </span>
              </div>
              <div className="space-y-2.5">
                {shown.map((p) => {
                  const c = summary.byPlatform[p];
                  return (
                    <div key={p}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">{platformLabel(p)}</span>
                        <span className="tabular-nums text-slate-500">
                          {c.posted.toLocaleString("en-IN")}/{c.expected.toLocaleString("en-IN")} · {percent(c)}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-2 rounded-full bg-emerald-500 transition-all"
                          style={{ width: `${c.expected === 0 ? 0 : (c.posted / c.expected) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:col-span-2">
              {(
                [
                  { s: "POSTED", hint: "matched a caption" },
                  { s: "NEEDS_REVIEW", hint: "waiting for a decision", href: "/dashboard/review" },
                  { s: "POSTED_OTHER", hint: "check for a miss", href: "/dashboard/review?lane=possible" },
                  { s: "NOT_POSTED", hint: "no post found" },
                  { s: "NO_ACCESS", hint: "no data returned" },
                ] as const
              ).map(({ s, hint, ...rest }) => {
                const href = "href" in rest ? rest.href : undefined;
                return (
                  <div key={s} className="rounded-xl border border-slate-200/90 bg-white p-3 shadow-xs">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
                      <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[s]}`} />
                      <span className="leading-tight">{STATUS_LABEL[s]}</span>
                    </div>
                    <div className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">
                      {summary.counts[s].toLocaleString("en-IN")}
                    </div>
                    {href ? (
                      <Link href={href} className="text-xs font-semibold text-blue-600 hover:underline">
                        {hint} &rarr;
                      </Link>
                    ) : (
                      <div className="text-xs text-slate-500">{hint}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200/90 bg-white p-4 shadow-xs md:flex-row md:flex-wrap md:items-center">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search volunteer or @handle..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50/50 py-2 pl-9 pr-9 text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center rounded-lg bg-slate-100 p-0.5 text-xs font-medium" role="group" aria-label="Platform">
              {(["all", ...COVERAGE_PLATFORMS] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPlatformFilter(p)}
                  aria-pressed={platformFilter === p}
                  className={`rounded-md px-2.5 py-1 transition ${
                    platformFilter === p ? "bg-white font-semibold text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {p === "all" ? "All" : PLATFORM_SHORT[p]}
                </button>
              ))}
            </div>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              aria-label="Status"
              className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All volunteers</option>
              <option value="INCOMPLETE">Anything still to post</option>
              <option value="NOT_POSTED">Has a caption not posted</option>
              <option value="POSTED_OTHER">Posted, but no caption matched</option>
              <option value="NEEDS_REVIEW">Has a post to review</option>
              <option value="NO_ACCESS">No data returned</option>
              <option value="DONE">Posted everything</option>
            </select>

            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              aria-label="Sort"
              className="rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="name">Sort: name</option>
              <option value="least">Sort: least posted first</option>
              <option value="most">Sort: most posted first</option>
            </select>

            <a
              href="/api/export/snapshots"
              download
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-slate-800 md:ml-auto"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Export snapshots CSV</span>
            </a>
          </div>

          {copied && (
            <Notice tone={copied.count < 0 ? "error" : "success"} onDismiss={() => setCopied(null)}>
              {copied.count < 0
                ? "Could not copy to the clipboard."
                : `Copied ${copied.count} volunteer${copied.count === 1 ? "" : "s"} who have not posted Caption ${copiedCaption}.`}
            </Notice>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
            {(Object.keys(CHIP_STYLE) as DayCellStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <span className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[9px] font-bold ${CHIP_STYLE[s]}`}>I</span>
                {STATUS_LABEL[s]}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-4 w-4 items-center justify-center text-slate-300">&ndash;</span>
              No account on that platform
            </span>
          </div>

          {/* Matrix */}
          <div className="overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-xs">
            {filteredRows.length === 0 ? (
              <div className="p-14 text-center text-slate-500">
                <p className="text-sm font-semibold text-slate-700">No volunteers match these filters</p>
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setStatusFilter("ALL");
                    setPlatformFilter("all");
                  }}
                  className="mt-3 text-xs font-semibold text-blue-600 hover:underline"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/90">
                      <th className="sticky left-0 z-20 min-w-[200px] border-r border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-600">
                        Volunteer ({filteredRows.length.toLocaleString("en-IN")})
                      </th>
                      {captions.map((c, i) => {
                        const cov = summary.byCaption[c.id];
                        return (
                          <th
                            key={c.id}
                            className="min-w-[150px] max-w-[200px] border-r border-slate-200 px-3 py-2.5 align-top"
                            title={`${c.title}\nReleased ${formatIstDateTime(c.releasedAt)}\n\n${c.canonicalCaption}`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs font-bold text-slate-700">C{i + 1}</span>
                              <button
                                type="button"
                                onClick={() => copyMissing(c.id)}
                                aria-label={`Copy volunteers who have not posted caption ${i + 1}`}
                                title="Copy the volunteers who have not posted this caption"
                                className="rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <div className="mt-1 truncate text-xs font-semibold normal-case text-slate-800">{c.title}</div>
                            <div className="text-xs font-normal normal-case tabular-nums text-slate-500">
                              {cov.posted.toLocaleString("en-IN")}/{cov.expected.toLocaleString("en-IN")} · {percent(cov)}
                            </div>
                          </th>
                        );
                      })}
                      <th className="min-w-[90px] px-3 py-3 text-xs font-bold uppercase tracking-wider text-slate-600">Done</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200/80">
                    {pagedRows.map(({ row, progress }) => (
                      <tr key={row.key} className="hover:bg-blue-50/20">
                        <td className="sticky left-0 z-10 border-r border-slate-200 bg-white px-4 py-2.5">
                          <div className="truncate font-semibold text-slate-900">{row.name}</div>
                          <div className="truncate text-xs text-slate-500">
                            {shown
                              .map((p) => row.accounts[p])
                              .filter((a): a is NonNullable<typeof a> => !!a)
                              .map((a) => `@${a.handle}`)
                              .join(" · ")}
                          </div>
                        </td>
                        {captions.map((c) => (
                          <td key={c.id} className="border-r border-slate-200/80 px-3 py-2.5">
                            <div className="flex items-center gap-1.5">
                              {shown.map((p) => (
                                <Chip
                                  key={p}
                                  platform={p}
                                  cell={row.cells[c.id]?.[p]}
                                  handle={row.accounts[p]?.handle}
                                  onOpen={() => setSelected({ row, platform: p })}
                                />
                              ))}
                            </div>
                          </td>
                        ))}
                        <td className="px-3 py-2.5 tabular-nums">
                          <span
                            className={`font-semibold ${
                              progress.expected > 0 && progress.posted === progress.expected ? "text-emerald-700" : "text-slate-800"
                            }`}
                          >
                            {progress.posted}/{progress.expected}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <nav aria-label="Volunteer pages" className="flex items-center justify-between border-t border-slate-100 bg-slate-50/60 px-5 py-3 text-xs text-slate-600">
                    <span>
                      {((currentPage - 1) * PAGE_SIZE + 1).toLocaleString("en-IN")}&ndash;
                      {Math.min(currentPage * PAGE_SIZE, filteredRows.length).toLocaleString("en-IN")} of{" "}
                      {filteredRows.length.toLocaleString("en-IN")} volunteers
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage <= 1}
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
                      >
                        Previous
                      </button>
                      <span>
                        Page {currentPage} of {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage >= totalPages}
                        className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:text-slate-300"
                      >
                        Next
                      </button>
                    </div>
                  </nav>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {selected && (
        <DayDetailDrawer
          row={selected.row}
          platform={selected.platform}
          day={day}
          captions={captions}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

interface ChipProps {
  platform: PlatformType;
  cell: DayCell | undefined;
  handle: string | undefined;
  onOpen: () => void;
}

/** One platform's state for one caption. No cell means the volunteer has no account there. */
function Chip({ platform, cell, handle, onOpen }: ChipProps) {
  if (!cell) {
    return (
      <span
        className="inline-flex h-6 w-6 items-center justify-center text-slate-300"
        title={`No ${platformLabel(platform)} account`}
        aria-label={`No ${platformLabel(platform)} account`}
      >
        &ndash;
      </span>
    );
  }
  const label = `${platformLabel(platform)} @${handle ?? ""}: ${STATUS_LABEL[cell.status]}${
    cell.status === "POSTED_OTHER" && cell.nearMiss ? " (close to this caption)" : ""
  }`;
  return (
    <button
      type="button"
      onClick={onOpen}
      title={label}
      aria-label={label}
      className={`inline-flex h-6 w-6 items-center justify-center rounded border text-[10px] font-bold transition hover:scale-110 focus:outline-none focus:ring-2 focus:ring-blue-500 ${CHIP_STYLE[cell.status]} ${
        cell.status === "POSTED_OTHER" && cell.nearMiss ? "ring-2 ring-amber-600" : ""
      }`}
    >
      {CHIP_LETTER[platform]}
    </button>
  );
}
