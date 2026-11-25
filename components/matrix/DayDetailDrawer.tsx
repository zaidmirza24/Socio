"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { getAccountDayPosts, type AccountDayPost } from "@/lib/supabase/matrix";
import type { CoverageCaption, DayCell, DayCellStatus, DayVolunteerRow } from "@/lib/coverage/day-coverage";
import { formatIstDateTime, formatMetric } from "@/lib/utils";
import { volunteerProfileHref } from "@/lib/utils/volunteer-links";
import type { PlatformType } from "@/types/database";

export const STATUS_LABEL: Record<DayCellStatus, string> = {
  POSTED: "Posted",
  NEEDS_REVIEW: "Needs review",
  POSTED_OTHER: "Posted, but no caption matched",
  NOT_POSTED: "Not posted",
  NO_ACCESS: "No data returned",
};

export const STATUS_DOT: Record<DayCellStatus, string> = {
  POSTED: "bg-emerald-500",
  NEEDS_REVIEW: "bg-blue-500",
  POSTED_OTHER: "bg-amber-400",
  NOT_POSTED: "bg-slate-300",
  NO_ACCESS: "bg-red-400",
};

const MATCH_LABEL: Record<string, string> = {
  matched: "Matched",
  needs_review: "Needs review",
  unmatched: "Not matched",
  rejected: "Rejected",
};

interface DayDetailDrawerProps {
  row: DayVolunteerRow;
  platform: PlatformType;
  day: string;
  captions: CoverageCaption[];
  onClose: () => void;
}

/** Side panel for one volunteer's account on one platform: the day's captions and the posts behind them. */
export function DayDetailDrawer({ row, platform, day, captions, onClose }: DayDetailDrawerProps) {
  const account = row.accounts[platform];
  const accountId = account?.accountId ?? null;
  const [posts, setPosts] = useState<AccountDayPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    setPosts(null);
    setError(null);
    getAccountDayPosts(accountId, day)
      .then((res) => {
        if (!cancelled) setPosts(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load the posts.");
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, day]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!account) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={`${row.name} on ${platform}`}>
      <button type="button" aria-label="Close details" className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 p-5">
          <div className="min-w-0">
            <Link
              href={volunteerProfileHref({ volunteerId: row.volunteerId, handle: account.handle, platform, from: "matrix" })}
              className="block truncate text-sm font-bold text-slate-900 hover:text-blue-600"
            >
              {row.name}
            </Link>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <PlatformBadge platform={platform} />
              <span className="truncate">@{account.handle}</span>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <section className="border-b border-slate-200 p-5">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Captions this day</h3>
          <ul className="space-y-1.5">
            {captions.map((c, i) => {
              const cell: DayCell | undefined = row.cells[c.id]?.[platform];
              const status = cell?.status ?? "NOT_POSTED";
              return (
                <li key={c.id} className="flex items-center gap-2 text-xs">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                  <span className="shrink-0 font-semibold text-slate-700">C{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-slate-600" title={c.title}>
                    {c.title}
                  </span>
                  {status === "NEEDS_REVIEW" && cell?.reviewId ? (
                    <Link href={`/dashboard/review?id=${cell.reviewId}`} className="shrink-0 font-semibold text-blue-600 hover:underline">
                      Review
                    </Link>
                  ) : (
                    <span className="shrink-0 text-slate-500">
                      {STATUS_LABEL[status]}
                      {status === "POSTED_OTHER" && cell?.nearMiss ? " (close)" : ""}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="p-5">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Posts</h3>
          {error ? (
            <p className="text-xs text-red-700">{error}</p>
          ) : posts === null ? (
            <p className="text-xs text-slate-500">Loading posts...</p>
          ) : posts.length === 0 ? (
            <p className="text-xs text-slate-500">This account has no posts on this day.</p>
          ) : (
            <ul className="space-y-3">
              {posts.map((p) => (
                <li key={p.id} className="rounded-lg border border-slate-200 p-3 text-xs">
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">{MATCH_LABEL[p.matchStatus] ?? p.matchStatus}</span>
                    <span suppressHydrationWarning className="tabular-nums text-slate-500">
                      {formatIstDateTime(p.postedAt)}
                    </span>
                  </div>
                  <p className="line-clamp-4 whitespace-pre-wrap font-mono leading-relaxed text-slate-600">
                    {p.caption || "(no caption)"}
                  </p>
                  {p.captionTitle && (
                    <p className="mt-1.5 text-slate-500">
                      {p.matchStatus === "matched" || p.matchStatus === "needs_review" ? "Caption" : "Closest caption"}:{" "}
                      <span className="font-semibold text-slate-700">{p.captionTitle}</span>
                      {p.matchStatus === "unmatched" && p.matchScore !== null && ` (${Math.round(p.matchScore * 100)}% similar)`}
                    </p>
                  )}
                  <div className="mt-2 flex items-center justify-between">
                    <span className="tabular-nums text-slate-600">
                      {formatMetric(p.likes)} likes · {formatMetric(p.comments)} comments · {formatMetric(p.views)} views
                    </span>
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-medium text-slate-500 hover:text-blue-600"
                    >
                      Open <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  {p.matchStatus === "unmatched" && p.matchScore !== null && p.matchScore >= 0.6 && (
                    <Link href="/dashboard/review?lane=possible" className="mt-2 inline-block font-semibold text-blue-600 hover:underline">
                      Check in Possible matches
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}
