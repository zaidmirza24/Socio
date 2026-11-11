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
import { formatNumber, formatDisplayDate } from "@/lib/utils";
import {
  createCampaignCaption,
  createCampaignCaptionsBulk,
  updateCaptionStatus,
  type CaptionWithStats,
} from "@/lib/supabase/captions";
import {
  parseCaptionsCSV,
  parseMultiBlockText,
  getSampleCSVTemplate,
  type ParsedCaptionItem,
} from "@/lib/utils/caption-importers";
import {
  UploadCloud,
  FileSpreadsheet,
  Layers,
  Download,
  Check,
  AlertTriangle,
} from "lucide-react";

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

  const [entryMode, setEntryMode] = useState<"single" | "bulk">("single");
  const [bulkFormat, setBulkFormat] = useState<"csv" | "text">("csv");
  const [bulkText, setBulkText] = useState("");
  const [parsedBatch, setParsedBatch] = useState<ParsedCaptionItem[]>([]);
  const [batchSummary, setBatchSummary] = useState({ valid: 0, duplicate: 0, invalid: 0 });
  const [csvFileName, setCsvFileName] = useState<string | null>(null);

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

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvFileName(file.name);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const res = parseCaptionsCSV(text);
      setParsedBatch(res.items);
      setBatchSummary({
        valid: res.validCount,
        duplicate: res.duplicateCount,
        invalid: res.invalidCount,
      });
    };
    reader.onerror = () => {
      setError("Failed to read the selected CSV file.");
    };
    reader.readAsText(file, "UTF-8");
  };

  const handleMultiBlockChange = (text: string) => {
    setBulkText(text);
    setError(null);
    if (!text.trim()) {
      setParsedBatch([]);
      setBatchSummary({ valid: 0, duplicate: 0, invalid: 0 });
      return;
    }

    const res = parseMultiBlockText(text);
    setParsedBatch(res.items);
    setBatchSummary({
      valid: res.validCount,
      duplicate: res.duplicateCount,
      invalid: res.invalidCount,
    });
  };

  const handleDownloadTemplate = () => {
    const csvContent = getSampleCSVTemplate();
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "campaign_captions_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleBulkSubmit = () => {
    const validItems = parsedBatch.filter((i) => i.status === "valid");
    if (validItems.length === 0) {
      setError("No valid captions available to submit.");
      return;
    }

    setError(null);
    setSuccess(null);

    startSubmitting(async () => {
      const payload = validItems.map((item) => ({
        title: item.title,
        canonicalCaption: item.canonicalCaption,
        releasedAt: item.releasedAt,
      }));

      const res = await createCampaignCaptionsBulk(payload);

      if (!res.success) {
        setError(res.error || "Failed to register bulk captions.");
      } else {
        const msg = `${res.insertedCount} captions registered successfully!${
          res.skippedDuplicatesCount > 0
            ? ` (${res.skippedDuplicatesCount} duplicate captions skipped).`
            : ""
        }`;
        setSuccess(msg);
        setParsedBatch([]);
        setBulkText("");
        setCsvFileName(null);
        setBatchSummary({ valid: 0, duplicate: 0, invalid: 0 });

        if (res.insertedCaptions && res.insertedCaptions.length > 0) {
          const newEntries: CaptionWithStats[] = res.insertedCaptions.map((c) => ({
            ...c,
            matchedPostsCount: 0,
            totalLikes: 0,
            totalComments: 0,
            totalViews: 0,
            variantsCount: 0,
          }));
          setCaptions((prev) => [...newEntries, ...prev]);
        }
      }
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <PlusCircle className="h-5 w-5 text-blue-600" />
            Register Campaign Captions
          </h2>

          {/* Mode Switcher Tabs */}
          <div className="inline-flex p-1 bg-slate-100 rounded-lg border border-slate-200/80">
            <button
              type="button"
              onClick={() => {
                setEntryMode("single");
                setError(null);
                setSuccess(null);
              }}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition ${
                entryMode === "single"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Single Caption
            </button>
            <button
              type="button"
              onClick={() => {
                setEntryMode("bulk");
                setError(null);
                setSuccess(null);
              }}
              className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition flex items-center gap-1.5 ${
                entryMode === "bulk"
                  ? "bg-white text-blue-600 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <Layers className="h-3.5 w-3.5" />
              Bulk Import (CSV / Text)
            </button>
          </div>
        </div>

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

        {/* ── MODE 1: SINGLE ENTRY ── */}
        {entryMode === "single" && (
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
        )}

        {/* ── MODE 2: BULK IMPORT (CSV & MULTI-BLOCK TEXT) ── */}
        {entryMode === "bulk" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBulkFormat("csv")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1.5 ${
                    bulkFormat === "csv"
                      ? "bg-white text-blue-700 shadow-sm border border-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                  CSV / Excel Spreadsheet
                </button>
                <button
                  type="button"
                  onClick={() => setBulkFormat("text")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1.5 ${
                    bulkFormat === "text"
                      ? "bg-white text-blue-700 shadow-sm border border-slate-200"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  <FileText className="h-4 w-4 text-blue-600" />
                  Paste Multi-Block Text
                </button>
              </div>

              {bulkFormat === "csv" && (
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 hover:underline"
                >
                  <Download className="h-3.5 w-3.5 text-slate-500" />
                  Download Sample CSV Template
                </button>
              )}
            </div>

            {/* CSV Upload Mode */}
            {bulkFormat === "csv" && (
              <div className="space-y-3">
                <label className="block border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-8 text-center cursor-pointer transition bg-slate-50/50 hover:bg-blue-50/30">
                  <input
                    type="file"
                    accept=".csv, text/csv, application/vnd.ms-excel"
                    onChange={handleCSVUpload}
                    className="hidden"
                  />
                  <UploadCloud className="h-10 w-10 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">
                    {csvFileName ? `Selected: ${csvFileName}` : "Click or drag & drop a .CSV / Excel file here"}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    Columns supported: <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">title</code>, <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">caption</code>, <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">release_date</code>
                  </p>
                </label>
              </div>
            )}

            {/* Multi-Block Text Mode */}
            {bulkFormat === "text" && (
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Paste Multiple Captions (Delimited by <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-blue-600">---</code>)
                </label>
                <textarea
                  rows={8}
                  value={bulkText}
                  onChange={(e) => handleMultiBlockChange(e.target.value)}
                  placeholder={`Title: National Youth Day Slogan\nCaption: Warm greetings on National Youth Day! May the ideals of Swami Vivekananda inspire our youth. #YouthDay\n---\nTitle: Swachhata Seva Campaign\nCaption: स्वच्छता ही सेवा अभियान में जुड़ें! आइए अपने आसपास को स्वच्छ बनाएं। #CleanIndia\n---`}
                  className="w-full px-3.5 py-2.5 border border-slate-300 rounded-lg text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <p className="text-xs text-slate-500">
                  Tip: Separate each campaign with <code className="font-mono font-bold">---</code> on its own line. Use <code className="font-mono">Title: ...</code> and <code className="font-mono">Caption: ...</code> tags or let the first line serve as title.
                </p>
              </div>
            )}

            {/* Parsed Pre-Submission Review Table */}
            {parsedBatch.length > 0 && (
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                      Batch Preview ({parsedBatch.length} Detected)
                    </span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                      {batchSummary.valid} Ready
                    </span>
                    {batchSummary.duplicate > 0 && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
                        {batchSummary.duplicate} Duplicates in batch
                      </span>
                    )}
                    {batchSummary.invalid > 0 && (
                      <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                        {batchSummary.invalid} Incomplete
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={handleBulkSubmit}
                    disabled={isSubmitting || batchSummary.valid === 0}
                    className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        Submitting Batch...
                      </>
                    ) : (
                      <>
                        <Check className="h-3.5 w-3.5" />
                        Register {batchSummary.valid} Valid Captions
                      </>
                    )}
                  </button>
                </div>

                <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                  {parsedBatch.map((item, idx) => (
                    <div
                      key={item.id}
                      className={`p-3 flex items-start justify-between gap-3 ${
                        item.status === "valid"
                          ? "bg-white"
                          : item.status === "duplicate_in_batch"
                          ? "bg-amber-50/40"
                          : "bg-red-50/40"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold text-slate-800 truncate">
                            #{idx + 1}. {item.title}
                          </span>
                          <span className="text-[11px] text-slate-400">
                            ({item.wordCount} words)
                          </span>
                        </div>
                        <p className="text-slate-600 line-clamp-2 font-mono text-[11px]">
                          {item.canonicalCaption}
                        </p>
                        {item.errorMessage && (
                          <p className="text-[11px] text-amber-700 mt-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 shrink-0" />
                            {item.errorMessage}
                          </p>
                        )}
                      </div>

                      <span
                        className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider ${
                          item.status === "valid"
                            ? "bg-emerald-100 text-emerald-800"
                            : item.status === "duplicate_in_batch"
                            ? "bg-amber-100 text-amber-800"
                            : "bg-red-100 text-red-800"
                        }`}
                      >
                        {item.status === "valid"
                          ? "Ready"
                          : item.status === "duplicate_in_batch"
                          ? "Duplicate"
                          : "Invalid"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
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
                      <span suppressHydrationWarning className="text-xs text-slate-400">
                        Released: {formatDisplayDate(caption.released_at)}
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

