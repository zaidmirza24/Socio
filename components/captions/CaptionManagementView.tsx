"use client";

import React, { useState, useEffect, useTransition } from "react";
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  Archive,
  RefreshCw,
  PlusCircle,
  Eye,
  Heart,
  MessageCircle,
  Hash,
} from "lucide-react";
import { formatNumber } from "@/lib/utils";
import {
  createCampaignCaption,
  updateCaptionStatus,
  type CaptionWithStats,
} from "@/lib/supabase/captions";

interface CaptionManagementViewProps {
  initialCaptions: CaptionWithStats[];
}

export function CaptionManagementView({ initialCaptions }: CaptionManagementViewProps) {
  const [captions, setCaptions] = useState<CaptionWithStats[]>(initialCaptions);
  const [title, setTitle] = useState("");
  const [canonicalCaption, setCanonicalCaption] = useState("");
  const [isSubmitting, startSubmitting] = useTransition();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const refreshCaptions = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/captions");
      const data = await res.json();
      if (data?.success && Array.isArray(data.captions)) {
        setCaptions(data.captions);
      }
    } catch (err) {
      console.error("Failed to refresh captions:", err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (initialCaptions && initialCaptions.length > 0) {
      setCaptions(initialCaptions);
    } else {
      refreshCaptions();
    }
  }, [initialCaptions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    startSubmitting(async () => {
      const result = await createCampaignCaption({
        title,
        canonicalCaption,
      });

      if (!result.success) {
        setError(result.error || "Failed to create caption.");
      } else {
        setSuccess(`Caption "${title}" registered successfully!`);
        setTitle("");
        setCanonicalCaption("");

        if (result.caption) {
          const newCaption: CaptionWithStats = {
            ...result.caption,
            matchedPostsCount: 0,
            totalLikes: 0,
            totalComments: 0,
            totalViews: 0,
            variantsCount: 0,
          };
          setCaptions((prev) => [newCaption, ...prev]);
        }
      }
    });
  };

  const handleToggleStatus = async (id: string, currentStatus: "active" | "archived") => {
    const nextStatus = currentStatus === "active" ? "archived" : "active";
    const result = await updateCaptionStatus(id, nextStatus);

    if (result.success) {
      setCaptions((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: nextStatus } : c))
      );
    } else {
      alert(`Failed to update caption status: ${result.error}`);
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            Campaign Caption Registry
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Register official canonical captions. The ingestion engine matches volunteers’ posts against these texts.
          </p>
        </div>

        {/* Schedule Notice Badge */}
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200/80 shrink-0">
          <Clock className="h-4 w-4 text-amber-600" />
          <span>Takes effect on the next scheduled run at 08:00 AM IST</span>
        </div>
      </div>

      {/* Registration Card */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <PlusCircle className="h-5 w-5 text-blue-600" />
          Register New Canonical Caption
        </h2>

        {error && (
          <div className="mb-4 p-3.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 flex items-start gap-2.5">
            <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-start gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
            <span>{success}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Campaign Title / Identifier
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Tree Planting Drive 2026 Announcement"
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Official Canonical Caption Text
            </label>
            <textarea
              rows={4}
              value={canonicalCaption}
              onChange={(e) => setCanonicalCaption(e.target.value)}
              placeholder="Paste the official text captions provided to volunteers. Include exact hashtags, links, and formatting..."
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-xs"
              required
            />
            <p className="text-xs text-slate-500 mt-1">
              Deterministic NFKC normalization and SHA-256 hex hashing are applied automatically upon submission.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSubmitting || !title.trim() || !canonicalCaption.trim()}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Registering...
                </>
              ) : (
                <>
                  <PlusCircle className="h-4 w-4" />
                  Register Campaign Caption
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Registered Captions List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-900">
              Registered Captions ({captions.length})
            </h2>
            <button
              onClick={refreshCaptions}
              disabled={isRefreshing}
              className="text-xs text-slate-500 hover:text-blue-600 transition flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-50"
              title="Refresh registered captions"
            >
              <RefreshCw className={`h-3 w-3 ${isRefreshing ? "animate-spin text-blue-600" : ""}`} />
              <span>{isRefreshing ? "Syncing..." : "Sync"}</span>
            </button>
          </div>
          <span className="text-xs text-slate-500">
            {captions.filter((c) => c.status === "active").length} Active
          </span>
        </div>

        {captions.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-500">
            <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-700">No campaign captions registered yet</p>
            <p className="text-xs text-slate-400 mt-1">
              Add your first canonical caption above to begin tracking volunteer publications.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {captions.map((caption) => {
              const isActive = caption.status === "active";

              return (
                <div
                  key={caption.id}
                  className={`bg-white rounded-xl border p-5 transition shadow-sm ${
                    isActive ? "border-slate-200" : "border-slate-200/60 bg-slate-50/50 opacity-75"
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          isActive
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : "bg-slate-100 text-slate-600 border border-slate-200"
                        }`}
                      >
                        {isActive ? "Active" : "Archived"}
                      </span>
                      <h3 className="font-semibold text-slate-900 text-sm sm:text-base">
                        {caption.title}
                      </h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400">
                        Released: {new Date(caption.released_at).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => handleToggleStatus(caption.id, caption.status)}
                        className={`text-xs px-2.5 py-1 rounded font-medium transition ${
                          isActive
                            ? "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                            : "text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                        }`}
                      >
                        {isActive ? "Archive" : "Activate"}
                      </button>
                    </div>
                  </div>

                  {/* Caption Content Box */}
                  <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-700 font-mono whitespace-pre-wrap border border-slate-200/80 mb-3 max-h-32 overflow-y-auto">
                    {caption.canonical_caption}
                  </div>

                  {/* Aggregate Reach & Metrics Row */}
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600 pt-2 border-t border-slate-100">
                    <div className="flex items-center gap-1.5 font-medium text-slate-900">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>{caption.matchedPostsCount} Verified Posts</span>
                    </div>

                    <div className="flex items-center gap-1 text-slate-500">
                      <Heart className="h-3.5 w-3.5 text-rose-500" />
                      <span>{formatNumber(caption.totalLikes)} Likes</span>
                    </div>

                    <div className="flex items-center gap-1 text-slate-500">
                      <MessageCircle className="h-3.5 w-3.5 text-blue-500" />
                      <span>{formatNumber(caption.totalComments)} Comments</span>
                    </div>

                    <div className="flex items-center gap-1 text-slate-500">
                      <Eye className="h-3.5 w-3.5 text-amber-500" />
                      <span>{formatNumber(caption.totalViews)} Views</span>
                    </div>

                    <div className="flex items-center gap-1 text-slate-400 ml-auto font-mono text-[11px]">
                      <Hash className="h-3.5 w-3.5" />
                      <span title={caption.caption_hash}>
                        {caption.caption_hash.slice(0, 12)}...
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

