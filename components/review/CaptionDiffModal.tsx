"use client";

import React, { useMemo } from "react";
import {
  X,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Split,
  AlertTriangle,
} from "lucide-react";
import { computeWordDiff } from "@/lib/matching/diff";
import type { ReviewQueueDisplayItem } from "@/lib/supabase/reviews";
import { formatDisplayDateTime } from "@/lib/utils";

interface CaptionDiffModalProps {
  item: ReviewQueueDisplayItem | null;
  isOpen: boolean;
  onClose: () => void;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  isProcessing: boolean;
}

export function CaptionDiffModal({
  item,
  isOpen,
  onClose,
  onApprove,
  onReject,
  isProcessing,
}: CaptionDiffModalProps) {
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen && !isProcessing) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isProcessing, onClose]);

  const { originalTokens, modifiedTokens } = useMemo(() => {
    if (!item) return { originalTokens: [], modifiedTokens: [] };
    return computeWordDiff(item.canonicalCaption, item.candidateCaption);
  }, [item]);

  if (!isOpen || !item) return null;

  const similarityPercent = Math.round(item.similarityScore * 100);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-4xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
              <Split className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 text-base">
                Side-by-Side Caption Review
              </h3>
              <p className="text-xs text-slate-500">
                {item.volunteerName} (@{item.accountHandle}) &bull; {item.captionTitle}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-200">
              <AlertTriangle className="h-3.5 w-3.5 text-blue-600" />
              {similarityPercent}% Match Score
            </span>

            <button
              onClick={onClose}
              disabled={isProcessing}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-200/60 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Sub-Header (Context & Live Link) */}
        <div className="px-6 py-2.5 bg-slate-100/60 border-b border-slate-200 flex items-center justify-between text-xs text-slate-600">
          <div className="flex items-center gap-4">
            <span>
              <strong>Platform:</strong> {item.platform.toUpperCase()}
            </span>
            <span suppressHydrationWarning>
              <strong>Detected:</strong> {formatDisplayDateTime(item.createdAt)}
            </span>
          </div>

          <a
            href={item.postUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 hover:text-blue-700 font-medium inline-flex items-center gap-1"
          >
            <span>View Live Post</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>

        {/* Diff Comparison Panes */}
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6 bg-slate-50/40">
          {/* Left Pane: Canonical */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Official Canonical Caption
              </span>
              <span className="text-[11px] text-red-600 font-medium">
                Omissions in Red
              </span>
            </div>

            <div className="text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed overflow-y-auto max-h-72 p-2 rounded bg-slate-50/50">
              {originalTokens.map((token, idx) => {
                if (token.type === "removed") {
                  return (
                    <mark
                      key={idx}
                      className="bg-red-100 text-red-800 line-through decoration-red-500 rounded px-1 py-0.5 font-bold"
                    >
                      {token.text}
                    </mark>
                  );
                }
                return <span key={idx}>{token.text}</span>;
              })}
            </div>
          </div>

          {/* Right Pane: Volunteer's Scraped Post */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-100">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Volunteer&apos;s Actual Post Caption
              </span>
              <span className="text-[11px] text-emerald-600 font-medium">
                Additions in Green
              </span>
            </div>

            <div className="text-xs font-mono text-slate-800 whitespace-pre-wrap leading-relaxed overflow-y-auto max-h-72 p-2 rounded bg-slate-50/50">
              {modifiedTokens.map((token, idx) => {
                if (token.type === "added") {
                  return (
                    <mark
                      key={idx}
                      className="bg-emerald-100 text-emerald-900 font-bold rounded px-1 py-0.5 border border-emerald-300"
                    >
                      {token.text}
                    </mark>
                  );
                }
                return <span key={idx}>{token.text}</span>;
              })}
            </div>
          </div>
        </div>

        {/* Modal Actions Footer */}
        <div className="px-6 py-4 border-t border-slate-200 bg-white flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-slate-500 text-center sm:text-left">
            Approving saves this variant hash to automatically match future posts with this variation.
          </p>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            <button
              onClick={() => onReject(item.id)}
              disabled={isProcessing}
              className="flex-1 sm:flex-none px-4 py-2 bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 font-medium text-sm rounded-lg border border-slate-200 hover:border-red-200 transition flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <XCircle className="h-4 w-4 text-red-500" />
              <span>Reject (Drop Post)</span>
            </button>

            <button
              onClick={() => onApprove(item.id)}
              disabled={isProcessing}
              className="flex-1 sm:flex-none px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm rounded-lg shadow-sm transition flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Approve &amp; Start Tracking</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
