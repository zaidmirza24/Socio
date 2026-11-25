"use client";

import React, { useState, useTransition } from "react";
import { CheckCircle2, ExternalLink, EyeOff, Search } from "lucide-react";
import { Notice } from "@/components/ui/Notice";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { confirmNearMiss, dismissNearMiss, type NearMissItem } from "@/lib/supabase/reviews";
import { formatDisplayDate } from "@/lib/utils";

interface PossibleMatchesListProps {
  items: NearMissItem[];
  /** Posts are listed for this many recent days. */
  days: number;
}

/**
 * Posts that did not match any caption but came close. This is the safety net for "did we miss a
 * genuine post?": the admin either confirms it (tracked like any match) or dismisses it.
 */
export function PossibleMatchesList({ items: initialItems, days }: PossibleMatchesListProps) {
  const [items, setItems] = useState<NearMissItem[]>(initialItems);
  const [searchTerm, setSearchTerm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const term = searchTerm.trim().toLowerCase();
  const visible = items.filter(
    (i) =>
      !term ||
      i.volunteerName.toLowerCase().includes(term) ||
      i.accountHandle.toLowerCase().includes(term) ||
      i.candidateCaption.toLowerCase().includes(term) ||
      i.bestCaptionTitle.toLowerCase().includes(term)
  );

  const run = (item: NearMissItem, action: (id: string) => Promise<{ success: boolean; error?: string }>, verb: string) => {
    setBusyId(item.postId);
    setError(null);
    startTransition(async () => {
      try {
        const res = await action(item.postId);
        if (res.success) {
          setItems((prev) => prev.filter((p) => p.postId !== item.postId));
        } else {
          setError(`Could not ${verb} this post: ${res.error}`);
        }
      } finally {
        setBusyId(null);
      }
    });
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-600">
        Posts from the last {days} days that did <span className="font-semibold">not</span> match a campaign caption
        but are fairly similar to one (60% or more). If one is really a campaign post, confirm it and it is tracked
        like any other match.
      </p>

      {error && (
        <Notice tone="error" onDismiss={() => setError(null)}>
          {error}
        </Notice>
      )}

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by volunteer, handle or caption..."
          className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
        />
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200/90 p-12 text-center text-slate-500">
          <CheckCircle2 className="h-6 w-6 mx-auto mb-2 text-emerald-500" />
          <p className="text-sm font-semibold text-slate-800">No close calls to check</p>
          <p className="text-xs mt-1">Every recent unmatched post is clearly different from the campaign captions.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {visible.map((item) => {
            const percent = Math.round(item.score * 100);
            const busy = isPending && busyId === item.postId;
            return (
              <div key={item.postId} className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-slate-900 text-xs truncate">{item.volunteerName}</span>
                    <span className="text-xs text-slate-500 truncate">@{item.accountHandle}</span>
                    <PlatformBadge platform={item.platform} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                      {percent}% similar
                    </span>
                    <span suppressHydrationWarning className="text-xs text-slate-500 tabular-nums">
                      {formatDisplayDate(item.postedAt)}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div>
                    <div className="mb-1 font-semibold text-slate-500">Their post</div>
                    <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 font-mono leading-relaxed text-slate-700 max-h-40 overflow-auto whitespace-pre-wrap">
                      {item.candidateCaption || "(no caption)"}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 font-semibold text-slate-500">
                      Closest campaign caption: <span className="text-slate-900">{item.bestCaptionTitle}</span>
                    </div>
                    <div className="rounded-lg border border-blue-200/70 bg-blue-50/40 p-3 font-mono leading-relaxed text-slate-700 max-h-40 overflow-auto whitespace-pre-wrap">
                      {item.bestCaptionText}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 text-xs">
                  <a
                    href={item.postUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-slate-500 hover:text-blue-600 inline-flex items-center gap-1 font-medium transition"
                  >
                    <span>Open live post</span>
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => run(item, dismissNearMiss, "dismiss")}
                      disabled={isPending}
                      className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition disabled:opacity-50 inline-flex items-center gap-1.5"
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      <span>Not a campaign post</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => run(item, (id) => confirmNearMiss(id, item.bestCaptionId), "confirm")}
                      disabled={isPending}
                      className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition disabled:opacity-50 inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{busy ? "Confirming..." : "It is this campaign post"}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
