"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  FileText,
  CheckCircle2,
  Clock,
  AlertCircle,
  EyeOff,
  Search,
  Download,
  ExternalLink,
  Heart,
  MessageCircle,
  Eye,
  Filter,
  X,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import type { MatrixData, MatrixCellStatus } from "@/lib/supabase/matrix";
import { formatMetric, formatDisplayDate } from "@/lib/utils";

interface VolunteersMatrixViewProps {
  data: MatrixData;
}

export function VolunteersMatrixView({ data }: VolunteersMatrixViewProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filteredRows = useMemo(() => {
    return data.rows.filter((row) => {
      // Search filter
      const matchesSearch =
        row.account.volunteerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        row.account.handle.toLowerCase().includes(searchTerm.toLowerCase());

      if (!matchesSearch) return false;

      // Status filter
      if (statusFilter === "ALL") return true;

      if (statusFilter === "NOT_VISIBLE") {
        return !row.account.isVisible;
      }

      // Check if any caption cell matches the status
      const cellStatuses = Object.values(row.cells).map((c) => c.status);
      return cellStatuses.includes(statusFilter as MatrixCellStatus);
    });
  }, [data.rows, searchTerm, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Executive KPI Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {/* Monitored Volunteers */}
        <div className="relative overflow-hidden bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs hover:border-slate-300 transition group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-blue-500" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Volunteers
            </span>
            <div className="h-7 w-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <Users className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
            {data.stats.totalVolunteers}
          </div>
          <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
            <span>Tracked Instagram accounts</span>
          </div>
        </div>

        {/* Active Captions */}
        <div className="relative overflow-hidden bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs hover:border-slate-300 transition group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-500" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Active Captions
            </span>
            <div className="h-7 w-7 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <FileText className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-slate-900 tracking-tight tabular-nums">
            {data.stats.activeCaptionsCount}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Canonical content releases
          </div>
        </div>

        {/* Verified Posts */}
        <div className="relative overflow-hidden bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs hover:border-slate-300 transition group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
              Verified Posts
            </span>
            <div className="h-7 w-7 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-2xl font-bold text-emerald-700 tracking-tight tabular-nums">
              {data.stats.totalPosted}
            </div>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
              {data.stats.completionRate}%
            </span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-1.5 mt-2 overflow-hidden">
            <div
              className="bg-emerald-500 h-1.5 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, data.stats.completionRate)}%` }}
            />
          </div>
        </div>

        {/* Pending Posts */}
        <div className="relative overflow-hidden bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs hover:border-slate-300 transition group">
          <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
              Pending
            </span>
            <div className="h-7 w-7 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
              <Clock className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-amber-700 tracking-tight tabular-nums">
            {data.stats.totalPending}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Awaiting publication detection
          </div>
        </div>

        {/* Review Queue */}
        <div className="relative overflow-hidden bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs hover:border-slate-300 transition group col-span-2 md:col-span-1">
          <div className="absolute top-0 left-0 right-0 h-1 bg-blue-600" />
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">
              Review Queue
            </span>
            <div className="h-7 w-7 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
              <AlertCircle className="h-4 w-4" />
            </div>
          </div>
          <div className="text-2xl font-bold text-blue-700 tracking-tight tabular-nums">
            {data.stats.totalNeedsReview}
          </div>
          <Link
            href="/dashboard/review"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-800 transition mt-1"
          >
            <span>Inspect queue</span>
            <ArrowUpRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      {/* Matrix Controls & Search */}
      <div className="bg-white rounded-xl border border-slate-200/90 p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by volunteer name or @handle..."
              className="w-full pl-9 pr-9 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-slate-400 shrink-0" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-xs bg-slate-50/50 hover:bg-white text-slate-700 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
            >
              <option value="ALL">All Statuses ({data.rows.length})</option>
              <option value="POSTED">🟢 Verified Posts Only</option>
              <option value="PENDING">🟡 Pending Only</option>
              <option value="NEEDS_REVIEW">🔵 Needs Review Only</option>
              <option value="NOT_VISIBLE">🔴 Inaccessible / Private</option>
            </select>
          </div>
        </div>

        {/* CSV Export Action Button */}
        <a
          href="/api/export/snapshots"
          download
          className="inline-flex items-center justify-center gap-2 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold transition shadow-xs shrink-0"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Export Snapshots CSV</span>
        </a>
      </div>

      {/* Volunteers x Captions Matrix Table */}
      <div className="bg-white rounded-xl border border-slate-200/90 shadow-xs overflow-hidden">
        {data.captions.length === 0 ? (
          <div className="p-16 text-center text-slate-500">
            <div className="h-12 w-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-3 text-slate-400">
              <FileText className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-800">No active campaign captions registered</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              Register official campaign copy in the Caption Registry to build the volunteer tracking matrix.
            </p>
            <div className="mt-4">
              <Link
                href="/dashboard/captions"
                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold shadow-xs transition"
              >
                <span>Add Campaign Captions</span>
              </Link>
            </div>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-16 text-center text-slate-500">
            <p className="text-sm font-semibold text-slate-700">No matching volunteers found</p>
            <p className="text-xs text-slate-400 mt-1">
              Try adjusting your search query or reset the status filter.
            </p>
            <button
              onClick={() => {
                setSearchTerm("");
                setStatusFilter("ALL");
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
                <tr className="bg-slate-50/90 border-b border-slate-200">
                  {/* Sticky Volunteer Column */}
                  <th className="sticky left-0 bg-slate-50 z-20 px-4 py-3.5 font-bold text-[11px] text-slate-600 uppercase tracking-wider min-w-[240px] border-r border-slate-200 shadow-[1px_0_3px_rgba(0,0,0,0.03)]">
                    Volunteer Account
                  </th>

                  {/* Caption Columns */}
                  {data.captions.map((caption) => (
                    <th
                      key={caption.id}
                      className="px-4 py-3.5 font-bold text-[11px] text-slate-600 uppercase tracking-wider min-w-[260px] max-w-[320px] border-r border-slate-200 last:border-r-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate" title={caption.title}>
                          {caption.title}
                        </span>
                        <span suppressHydrationWarning className="text-[10px] text-slate-400 font-normal shrink-0 tabular-nums">
                          {formatDisplayDate(caption.releasedAt)}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200/80">
                {filteredRows.map((row) => {
                  const { account } = row;

                  return (
                    <tr key={account.id} className="hover:bg-blue-50/20 transition-colors">
                      {/* Sticky Volunteer Profile Cell */}
                      <td className="sticky left-0 bg-white group-hover:bg-slate-50/80 z-10 px-4 py-3.5 border-r border-slate-200 shadow-[1px_0_3px_rgba(0,0,0,0.03)]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link
                              href={`/dashboard/volunteers/${account.handle}?from=matrix`}
                              className="font-semibold text-slate-900 hover:text-blue-600 text-xs truncate block transition"
                            >
                              {account.volunteerName}
                            </Link>
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">
                              @{account.handle}
                            </div>
                          </div>

                          {/* Visibility Flag Badge */}
                          {account.isVisible ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/70 shrink-0"
                              title="Account is public and accessible"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                              Active
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200/70 shrink-0"
                              title="Account returned 0 posts or is private"
                            >
                              <EyeOff className="h-3 w-3 text-red-500" />
                              Private
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Caption Cells */}
                      {data.captions.map((caption) => {
                        const cell = row.cells[caption.id];

                        return (
                          <td
                            key={caption.id}
                            className="px-4 py-3 border-r border-slate-200/80 last:border-r-0 align-top"
                          >
                            {cell?.status === "POSTED" && cell.post ? (
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/80">
                                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                    Verified
                                  </span>

                                  <a
                                    href={cell.post.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-slate-400 hover:text-blue-600 transition"
                                    title="Open post on Instagram"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </div>

                                {/* Live Metrics */}
                                <div className="flex items-center gap-2.5 text-[11px] text-slate-600 font-mono tabular-nums pt-0.5">
                                  <span className="flex items-center gap-1" title="Cumulative Likes">
                                    <Heart className="h-3 w-3 text-rose-500" />
                                    {formatMetric(cell.post.likes)}
                                  </span>
                                  <span className="flex items-center gap-1" title="Cumulative Comments">
                                    <MessageCircle className="h-3 w-3 text-blue-500" />
                                    {formatMetric(cell.post.comments)}
                                  </span>
                                  <span className="flex items-center gap-1" title="Cumulative Views">
                                    <Eye className="h-3 w-3 text-amber-500" />
                                    {formatMetric(cell.post.views)}
                                  </span>
                                </div>
                                {cell.posts && cell.posts.length > 1 && (
                                  <div className="text-[10px] text-blue-600 font-medium pt-0.5">
                                    +{cell.posts.length - 1} extra post{cell.posts.length > 2 ? "s" : ""}
                                  </div>
                                )}
                              </div>
                            ) : cell?.status === "NEEDS_REVIEW" ? (
                              <Link
                                href={`/dashboard/review?id=${cell.reviewQueueId}`}
                                className="block p-2 rounded-lg bg-blue-50/80 hover:bg-blue-100/90 border border-blue-200 transition group"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-800">
                                    <AlertCircle className="h-3 w-3 text-blue-600" />
                                    Review
                                  </span>
                                  <span className="text-[10px] font-mono font-bold text-blue-700 bg-blue-100/80 px-1 py-0.2 rounded">
                                    {Math.round((cell.similarityScore ?? 0.9) * 100)}%
                                  </span>
                                </div>
                                <div className="text-[10px] text-blue-600 group-hover:underline mt-1 font-medium">
                                  Open diff &rarr;
                                </div>
                              </Link>
                            ) : cell?.status === "NOT_VISIBLE" ? (
                              <div className="flex items-center gap-1.5 text-[11px] text-red-600 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-red-500"></span>
                                <span>Private Account</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-[11px] text-amber-700 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
                                <span>Pending</span>
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
