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
} from "lucide-react";
import type { MatrixData, MatrixCellStatus } from "@/lib/supabase/matrix";
import { formatMetric } from "@/lib/utils";

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
      {/* KPI Stats Bar */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
            <Users className="h-4 w-4 text-blue-600" />
            <span>Monitored Volunteers</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{data.stats.totalVolunteers}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Active profiles tracked</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-slate-500 text-xs font-medium mb-1">
            <FileText className="h-4 w-4 text-indigo-600" />
            <span>Active Captions</span>
          </div>
          <div className="text-2xl font-bold text-slate-900">{data.stats.activeCaptionsCount}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Canonical content items</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-emerald-700 text-xs font-medium mb-1">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>Verified Posts</span>
          </div>
          <div className="text-2xl font-bold text-emerald-700">
            {data.stats.totalPosted}{" "}
            <span className="text-xs font-normal text-slate-500">
              ({data.stats.completionRate}%)
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-0.5">Total verified publications</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-amber-700 text-xs font-medium mb-1">
            <Clock className="h-4 w-4 text-amber-600" />
            <span>Pending Posts</span>
          </div>
          <div className="text-2xl font-bold text-amber-700">{data.stats.totalPending}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">Awaiting volunteer posting</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 text-blue-700 text-xs font-medium mb-1">
            <AlertCircle className="h-4 w-4 text-blue-600" />
            <span>Review Queue</span>
          </div>
          <div className="text-2xl font-bold text-blue-700">
            {data.stats.totalNeedsReview}
          </div>
          <Link
            href="/dashboard/review"
            className="text-[11px] text-blue-600 hover:text-blue-700 font-medium block mt-0.5"
          >
            Open review queue &rarr;
          </Link>
        </div>
      </div>

      {/* Matrix Controls & Search */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {/* Search Box */}
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by volunteer name or @handle..."
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-slate-400 shrink-0" />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="ALL">All Statuses</option>
              <option value="POSTED">🟢 Posted Only</option>
              <option value="PENDING">🟡 Pending Only</option>
              <option value="NEEDS_REVIEW">🔵 Needs Review Only</option>
              <option value="NOT_VISIBLE">🔴 Not Visible / Private Only</option>
            </select>
          </div>
        </div>

        {/* CSV Export Action Button */}
        <a
          href="/api/export/snapshots"
          download
          className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-sm font-medium transition shadow-sm shrink-0"
        >
          <Download className="h-4 w-4" />
          <span>Export Snapshots CSV</span>
        </a>
      </div>

      {/* Volunteers x Captions Matrix Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {data.captions.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-700">No active campaign captions registered</p>
            <p className="text-xs text-slate-400 mt-1">
              Register active captions in the{" "}
              <Link href="/dashboard/captions" className="text-blue-600 hover:underline">
                Caption Registry
              </Link>{" "}
              to build the monitoring matrix.
            </p>
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="p-12 text-center text-slate-500">
            <p className="text-sm font-medium text-slate-700">No matching volunteers found</p>
            <p className="text-xs text-slate-400 mt-1">
              Try adjusting your search query or status filter.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200">
                  {/* Sticky Volunteer Column */}
                  <th className="sticky left-0 bg-slate-50 z-20 px-4 py-3.5 font-semibold text-xs text-slate-700 uppercase tracking-wider min-w-[240px] border-r border-slate-200">
                    Volunteer Account
                  </th>

                  {/* Caption Columns */}
                  {data.captions.map((caption) => (
                    <th
                      key={caption.id}
                      className="px-4 py-3.5 font-semibold text-xs text-slate-700 uppercase tracking-wider min-w-[260px] max-w-[320px] border-r border-slate-200 last:border-r-0"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate" title={caption.title}>
                          {caption.title}
                        </span>
                        <span className="text-[10px] text-slate-400 font-normal shrink-0">
                          {new Date(caption.releasedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-slate-200">
                {filteredRows.map((row) => {
                  const { account } = row;

                  return (
                    <tr key={account.id} className="hover:bg-slate-50/60 transition">
                      {/* Sticky Volunteer Profile Cell */}
                      <td className="sticky left-0 bg-white group-hover:bg-slate-50/60 z-10 px-4 py-3.5 border-r border-slate-200">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 text-sm truncate">
                              {account.volunteerName}
                            </div>
                            <div className="text-xs text-slate-500 truncate">
                              @{account.handle}
                            </div>
                          </div>

                          {/* Visibility Flag Badge */}
                          {account.isVisible ? (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0"
                              title="Account is public and accessible"
                            >
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                              Visible
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-700 border border-red-200 shrink-0"
                              title="Account returned 0 posts or is private"
                            >
                              <EyeOff className="h-3 w-3 text-red-500" />
                              Not Visible
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
                            className="px-4 py-3 border-r border-slate-200 last:border-r-0 align-top"
                          >
                            {cell?.status === "POSTED" && cell.post ? (
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-1.5">
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                    Posted
                                  </span>

                                  <a
                                    href={cell.post.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-slate-400 hover:text-blue-600 transition"
                                    title="Open post in new tab"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                </div>

                                {/* Live Metrics */}
                                <div className="flex items-center gap-3 text-xs text-slate-600 pt-0.5">
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
                                    +{cell.posts.length - 1} additional post{cell.posts.length > 2 ? "s" : ""}
                                  </div>
                                )}
                              </div>
                            ) : cell?.status === "NEEDS_REVIEW" ? (
                              <Link
                                href={`/dashboard/review?id=${cell.reviewQueueId}`}
                                className="block p-2 rounded-lg bg-blue-50/80 hover:bg-blue-100 border border-blue-200 transition group"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-800">
                                    <AlertCircle className="h-3.5 w-3.5 text-blue-600" />
                                    Needs Review
                                  </span>
                                  <span className="text-[11px] font-mono font-medium text-blue-600">
                                    {Math.round((cell.similarityScore ?? 0.9) * 100)}% Match
                                  </span>
                                </div>
                                <div className="text-[11px] text-blue-600 group-hover:underline mt-1">
                                  Click to open diff viewer &rarr;
                                </div>
                              </Link>
                            ) : cell?.status === "NOT_VISIBLE" ? (
                              <div className="flex items-center gap-1.5 text-xs text-red-600 font-medium">
                                <span className="h-2 w-2 rounded-full bg-red-500"></span>
                                <span>Not Visible (Private Account)</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-xs text-amber-700 font-medium">
                                <span className="h-2 w-2 rounded-full bg-amber-400"></span>
                                <span>Pending Detection</span>
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

