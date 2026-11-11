"use client";

import React, { useState, useEffect, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import {
  CheckSquare,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Split,
  Search,
  RefreshCw,
  Clock,
  Sparkles,
} from "lucide-react";
import {
  approveReviewItem,
  rejectReviewItem,
  type ReviewQueueDisplayItem,
} from "@/lib/supabase/reviews";
import { formatDisplayDate } from "@/lib/utils";
import { CaptionDiffModal } from "./CaptionDiffModal";

interface ReviewQueueViewProps {
  initialItems: ReviewQueueDisplayItem[];
}

export function ReviewQueueView({ initialItems }: ReviewQueueViewProps) {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<ReviewQueueDisplayItem[]>(initialItems);
  const [selectedItem, setSelectedItem] = useState<ReviewQueueDisplayItem | null>(null);
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "rejected" | "ALL">("pending");
  const [searchTerm, setSearchTerm] = useState("");
  const [isProcessing, startProcessing] = useTransition();

  const [processingId, setProcessingId] = useState<string | null>(null);

  useEffect(() => {
    const targetId = searchParams?.get("id");
    if (targetId && items.length > 0) {
      const match = items.find((i) => i.id === targetId);
      if (match) {
        setSelectedItem(match);
      }
    }
  }, [searchParams, items]);

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    startProcessing(async () => {
      try {
        const res = await approveReviewItem(id);
        if (res.success) {
          setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, status: "approved" } : item))
          );
          setSelectedItem(null);
        } else {
          alert(`Failed to approve review item: ${res.error}`);
        }
      } finally {
        setProcessingId(null);
      }
    });
  };

  const handleReject = async (id: string) => {
    setProcessingId(id);
    startProcessing(async () => {
      try {
        const res = await rejectReviewItem(id);
        if (res.success) {
          setItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, status: "rejected" } : item))
          );
          setSelectedItem(null);
        } else {
          alert(`Failed to reject review item: ${res.error}`);
        }
      } finally {
        setProcessingId(null);
      }
    });
  };

  const filteredItems = items.filter((item) => {
    if (statusFilter !== "ALL" && item.status !== statusFilter) {
      return false;
    }
    const matchesSearch =
      item.volunteerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.accountHandle.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.captionTitle.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.candidateCaption.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <CheckSquare className="h-6 w-6 text-blue-600" />
              Caption Review Queue
            </h1>
            <span className="text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 px-2 py-0.5 rounded-full">
              Dynamic Similarity Engine
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Volunteers whose captions matched at 90–99% similarity. Review additions and omissions side-by-side before publishing to the dashboard.
          </p>
        </div>

        {pendingCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            {pendingCount} Awaiting Decision
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200/80 shrink-0">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Queue Up To Date
          </span>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by volunteer, handle, or caption keywords..."
            className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
          />
        </div>

        {/* Status Filters */}
        <div className="flex items-center bg-slate-100/80 p-1 rounded-lg border border-slate-200/80 self-start md:self-auto">
          <button
            onClick={() => setStatusFilter("pending")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              statusFilter === "pending"
                ? "bg-white text-blue-700 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Pending ({items.filter((i) => i.status === "pending").length})
          </button>

          <button
            onClick={() => setStatusFilter("approved")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              statusFilter === "approved"
                ? "bg-white text-blue-700 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Approved ({items.filter((i) => i.status === "approved").length})
          </button>

          <button
            onClick={() => setStatusFilter("rejected")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              statusFilter === "rejected"
                ? "bg-white text-blue-700 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            Rejected ({items.filter((i) => i.status === "rejected").length})
          </button>

          <button
            onClick={() => setStatusFilter("ALL")}
            className={`px-3 py-1.5 rounded-md text-xs font-semibold transition ${
              statusFilter === "ALL"
                ? "bg-white text-blue-700 shadow-xs"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            All
          </button>
        </div>
      </div>

      {/* Review Queue Items */}
      <div className="space-y-4">
        {filteredItems.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200/90 p-16 text-center text-slate-500">
            <div className="h-12 w-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <CheckSquare className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold text-slate-800">No review queue items found</p>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Posts matching official campaigns with slight volunteer modifications (greetings, local hashtags, minor typos) will appear here for one-click verification.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredItems.map((item) => {
              const similarityPercent = Math.round(item.similarityScore * 100);
              const isPending = item.status === "pending";
              const isItemBusy = isProcessing && processingId === item.id;

              const scoreColorClass =
                similarityPercent >= 95
                  ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                  : similarityPercent >= 90
                  ? "bg-blue-50 text-blue-800 border-blue-200"
                  : "bg-amber-50 text-amber-800 border-amber-200";

              return (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-slate-200/90 p-5 shadow-xs hover:border-slate-300 transition"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-tr from-blue-500 to-indigo-600 text-white font-bold text-xs flex items-center justify-center">
                        {item.volunteerName.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-900 text-xs">
                            {item.volunteerName}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            @{item.accountHandle}
                          </span>
                        </div>
                        <span className="text-[10px] font-mono uppercase text-slate-500">
                          {item.platform}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.status === "approved" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                          Approved
                        </span>
                      ) : item.status === "rejected" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200">
                          <XCircle className="h-3.5 w-3.5 text-red-500" />
                          Rejected
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${scoreColorClass}`}>
                          <Sparkles className="h-3 w-3 text-blue-600" />
                          {similarityPercent}% Match Score
                        </span>
                      )}

                      <span suppressHydrationWarning className="text-[11px] text-slate-400 tabular-nums">
                        {formatDisplayDate(item.createdAt)}
                      </span>
                    </div>
                  </div>

                  {/* Campaign Target */}
                  <div className="text-xs text-slate-600 mb-2">
                    <span className="font-semibold text-slate-500">Matched Campaign:</span>{" "}
                    <span className="font-semibold text-slate-900">{item.captionTitle}</span>
                  </div>

                  {/* Candidate Caption Snippet */}
                  <div className="bg-slate-50/70 rounded-lg p-3 text-xs text-slate-700 font-mono border border-slate-200/80 mb-3 max-h-24 overflow-hidden text-ellipsis line-clamp-3 leading-relaxed">
                    {item.candidateCaption}
                  </div>

                  {/* Action Controls */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100 text-xs">
                    <a
                      href={item.postUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-slate-500 hover:text-blue-600 inline-flex items-center gap-1 font-medium transition"
                    >
                      <span>Open Live Post</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedItem(item)}
                        className="px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold transition flex items-center gap-1.5"
                      >
                        <Split className="h-3.5 w-3.5" />
                        <span>Inspect Diff</span>
                      </button>

                      {isPending && (
                        <>
                          <button
                            onClick={() => handleReject(item.id)}
                            disabled={isProcessing}
                            className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 text-xs font-semibold border border-slate-200 transition disabled:opacity-50"
                          >
                            Reject
                          </button>

                          <button
                            onClick={() => handleApprove(item.id)}
                            disabled={isProcessing}
                            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition disabled:opacity-50 flex items-center gap-1"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Approve</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Side-by-Side Diff Modal */}
      <CaptionDiffModal
        item={selectedItem}
        isOpen={selectedItem !== null}
        onClose={() => setSelectedItem(null)}
        onApprove={handleApprove}
        onReject={handleReject}
        isProcessing={isProcessing}
      />
    </div>
  );
}
