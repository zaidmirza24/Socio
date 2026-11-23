"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  Copy,
  Check,
  Heart,
  MessageCircle,
  Eye,
  Instagram,
  Twitter,
  Facebook,
  Layers,
  LayoutGrid,
  List,
  Search,
  Filter,
  Calendar,
  Sparkles,
  Share2,
  Quote,
  Grid,
  BarChart3,
  Users,
} from "lucide-react";
import { formatMetric, formatNumber, formatDayLabel, getDateFilterSince } from "@/lib/utils";
import { sumMeasured } from "@/lib/metrics/integrity";
import { EngagementTrendChart } from "@/components/charts/EngagementTrendChart";
import { DateRangeFilter } from "@/components/analytics/DateRangeFilter";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { AddAccountButton } from "@/components/volunteers/AddAccountButton";
import { platformLabel as labelOf } from "@/lib/platform";
import { accountProfileHref } from "@/lib/utils/volunteer-links";
import type { VolunteerProfileData, DateRangePreset } from "@/lib/supabase/queries";

interface VolunteerDetailViewProps {
  data: VolunteerProfileData;
  initialRange?: DateRangePreset;
}

// ── Platform-aware helpers ────────────────────────────────────────────────
function platformIcon(platform: string) {
  return platform === "facebook" ? Facebook : platform === "x" ? Twitter : Instagram;
}

function platformIconColor(platform: string): string {
  return platform === "facebook" ? "text-blue-600" : platform === "x" ? "text-sky-500" : "text-rose-500";
}

function platformProfileUrl(platform: string, handle: string): string {
  return platform === "facebook"
    ? `https://www.facebook.com/${handle}/`
    : platform === "x"
    ? `https://x.com/${handle}`
    : `https://www.instagram.com/${handle}/`;
}

function profileButtonStyle(platform: string): string {
  return platform === "facebook"
    ? "bg-gradient-to-r from-blue-600 to-blue-700"
    : platform === "x"
    ? "bg-gradient-to-r from-slate-800 to-sky-600"
    : "bg-gradient-to-r from-rose-500 to-indigo-600";
}
// ───────────────────────────────────────────────────────────────────────────

export function VolunteerDetailView({ data, initialRange = "today" }: VolunteerDetailViewProps) {
  const { account, timeline: defaultTimeline, posts, accounts } = data;
  const isVolunteerScope = data.scope === "volunteer";
  const searchParams = useSearchParams();
  const fromSource = searchParams?.get("from");
  const isFromMatrix = fromSource === "matrix";
  const isFromVolunteers = fromSource === "volunteers";

  const [dateFilter, setDateFilter] = useState<DateRangePreset>(initialRange);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [copiedHandle, setCopiedHandle] = useState(false);
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [mediaFilter, setMediaFilter] = useState<string>("all");
  // Only meaningful on a volunteer page, where posts from several platforms are combined.
  const [platformFilter, setPlatformFilter] = useState<string>("all");

  const platform = account.platform ?? "instagram";
  const PlatformIcon = platformIcon(platform);
  const platformLabel = labelOf(platform);
  const backHref = isFromMatrix
    ? "/dashboard?view=matrix"
    : isFromVolunteers
    ? "/dashboard/volunteers"
    : "/dashboard?view=analytics&tab=volunteers";
  const backLabel = isFromMatrix ? "Back to Matrix" : isFromVolunteers ? "Back to Volunteers" : "Back to Volunteer Leaderboard";

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedLink(id);
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const handleCopyHandle = () => {
    navigator.clipboard.writeText(`@${account.handle}`);
    setCopiedHandle(true);
    setTimeout(() => setCopiedHandle(false), 2000);
  };

  // Date cutoff calculation — uses IST-aware getDateFilterSince
  const cutoffDate = useMemo(() => {
    return getDateFilterSince(dateFilter);
  }, [dateFilter]);

  // Filter posts by date. postedAt is already IST ("2026-11-10 09:30"), so its first 10
  // characters are the IST calendar day.
  const platformFilteredPosts = useMemo(
    () => (isVolunteerScope && platformFilter !== "all" ? posts.filter((p) => p.platform === platformFilter) : posts),
    [posts, isVolunteerScope, platformFilter]
  );

  const dateFilteredPosts = useMemo(() => {
    if (!cutoffDate) return platformFilteredPosts;
    return platformFilteredPosts.filter((p) => !!p.postedAt && p.postedAt.slice(0, 10) >= cutoffDate);
  }, [platformFilteredPosts, cutoffDate]);

  // Recalculate metrics for the selected date range
  const metrics = useMemo(() => {
    // null = nothing measured (e.g. hidden likes): shown as "n/a", never as a made-up 0.
    const totalLikes = sumMeasured(dateFilteredPosts.map((p) => p.likes));
    const totalComments = sumMeasured(dateFilteredPosts.map((p) => p.comments));
    const totalViews = sumMeasured(dateFilteredPosts.map((p) => p.views));
    const totalMonitoredPosts = dateFilteredPosts.length;
    const avgEngagementPerPost =
      totalMonitoredPosts > 0 && (totalLikes !== null || totalComments !== null)
        ? Math.round(((totalLikes ?? 0) + (totalComments ?? 0)) / totalMonitoredPosts)
        : null;

    return {
      totalMonitoredPosts,
      totalLikes,
      totalComments,
      totalViews,
      avgEngagementPerPost,
    };
  }, [dateFilteredPosts]);

  // Filter timeline for the selected date range
  const timeline = useMemo(() => {
    // The server timeline covers every platform, so it is only valid when no platform is picked.
    if (dateFilter === "all" && platformFilter === "all") return defaultTimeline;
    const byDate = new Map<string, { likes: number; comments: number }>();
    for (const p of dateFilteredPosts) {
      const dateKey = p.postedAt ? p.postedAt.slice(0, 10) : "unknown";
      if (dateKey !== "unknown") {
        const existing = byDate.get(dateKey) ?? { likes: 0, comments: 0 };
        byDate.set(dateKey, {
          likes: existing.likes + (p.likes ?? 0),
          comments: existing.comments + (p.comments ?? 0),
        });
      }
    }
    return Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, v]) => ({
        date: formatDayLabel(date),
        likes: v.likes,
        comments: v.comments,
      }));
  }, [defaultTimeline, dateFilter, platformFilter, dateFilteredPosts]);

  // Filter posts by search and media type
  const filteredPosts = useMemo(() => {
    return dateFilteredPosts.filter((p) => {
      const matchesSearch = searchQuery
        ? (p.caption || "").toLowerCase().includes(searchQuery.toLowerCase())
        : true;
      const matchesType =
        mediaFilter === "all"
          ? true
          : (p.mediaType || "").toLowerCase() === mediaFilter.toLowerCase();
      return matchesSearch && matchesType;
    });
  }, [dateFilteredPosts, searchQuery, mediaFilter]);

  return (
    <div className="space-y-6">
      {/* ── Drill-Down Breadcrumb & Navigation Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2 text-slate-500">
          {/* Primary Back Button */}
          <Link
            href={backHref}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-800 font-bold hover:bg-blue-50 hover:text-blue-700 hover:border-blue-200 shadow-xs transition"
          >
            <ArrowLeft className="h-3.5 w-3.5 text-blue-600" />
            <span>{backLabel}</span>
          </Link>

          <span className="text-slate-300">/</span>

          <Link
            href="/dashboard?view=analytics&tab=volunteers"
            className="text-slate-600 hover:text-blue-600 font-medium transition"
          >
            Leaderboard
          </Link>

          <span className="text-slate-300">/</span>

          <span className="font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded-md">
            {isVolunteerScope ? account.volunteerName : `@${account.handle}`}
          </span>
        </div>

        {/* Secondary Drilling Shortcuts */}
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {!isFromMatrix ? (
            <Link
              href="/dashboard?view=matrix"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white text-slate-600 hover:text-blue-600 text-xs font-semibold transition"
              title="View this volunteer's post cells across active campaigns in the Matrix"
            >
              <Grid className="h-3.5 w-3.5 text-slate-500" />
              <span>View in Matrix</span>
            </Link>
          ) : (
            <Link
              href="/dashboard?view=analytics&tab=volunteers"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white text-slate-600 hover:text-blue-600 text-xs font-semibold transition"
              title="View ranking and comparison in Volunteer Leaderboard"
            >
              <BarChart3 className="h-3.5 w-3.5 text-slate-500" />
              <span>View Leaderboard</span>
            </Link>
          )}

          <Link
            href="/dashboard/accounts"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white text-slate-600 hover:text-blue-600 text-xs font-semibold transition"
          >
            <Users className="h-3.5 w-3.5 text-slate-500" />
            <span>Directory</span>
          </Link>
        </div>
      </div>

      {/* ── Volunteer Profile Header ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4">
            {/* Avatar Circle */}
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 text-white shadow-md text-2xl font-bold">
              {account.volunteerName.charAt(0).toUpperCase()}
              {!isVolunteerScope && (
                <div className="absolute -bottom-1 -right-1 rounded-full bg-white p-1 shadow-sm">
                  <PlatformIcon className={`h-4 w-4 ${platformIconColor(platform)}`} />
                </div>
              )}
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                  {account.volunteerName}
                </h1>
                <span
                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                    account.status === "active"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-amber-50 text-amber-700 border-amber-200"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full mr-1.5 ${
                      account.status === "active" ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  {account.status === "active" ? "Active" : "Paused"}
                </span>
              </div>

              <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                {isVolunteerScope ? (
                  <span>
                    {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
                  </span>
                ) : (
                  <button
                    onClick={handleCopyHandle}
                    className="font-mono text-blue-600 hover:text-blue-800 flex items-center gap-1 transition"
                    title="Click to copy handle"
                  >
                    @{account.handle}
                    {copiedHandle ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3 w-3 text-slate-500" />
                    )}
                  </button>
                )}
                <span>·</span>
                <span>
                  {isVolunteerScope ? "Total followers" : "Followers"}:{" "}
                  <strong className="text-slate-800 font-semibold">
                    {formatMetric(account.followers)}
                  </strong>
                </span>
                {account.following !== null && (
                  <>
                    <span>·</span>
                    <span>Following: {formatMetric(account.following)}</span>
                  </>
                )}
                {account.totalPostsOnPlatform !== null && (
                  <>
                    <span>·</span>
                    <span>Total {platformLabel} Posts: {formatMetric(account.totalPostsOnPlatform)}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Action buttons & Date Range Filter */}
          <div className="flex flex-wrap items-center gap-3">
            <DateRangeFilter value={dateFilter} onChange={setDateFilter} size="sm" />
            {(isVolunteerScope ? accounts : [{ platform, handle: account.handle }]).map((a) => {
              const Icon = platformIcon(a.platform);
              return (
                <a
                  key={`${a.platform}:${a.handle}`}
                  href={platformProfileUrl(a.platform, a.handle)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl ${profileButtonStyle(a.platform)} text-white font-medium text-sm shadow-sm hover:opacity-95 transition`}
                >
                  <Icon className="h-4 w-4" />
                  View {labelOf(a.platform)} Profile
                  <ExternalLink className="h-3.5 w-3.5 opacity-80" />
                </a>
              );
            })}
          </div>
        </div>

        {/* All of this volunteer's accounts: totals per platform, each linking to its own page */}
        {accounts.length > 0 && (data.volunteerId !== null || accounts.length > 1) && (
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Accounts ({accounts.length})
              </span>
              {data.volunteerId && (
                <AddAccountButton volunteerId={data.volunteerId} existingPlatforms={accounts.map((a) => a.platform)} />
              )}
              {!isVolunteerScope && data.volunteerId && (
                <Link
                  href={`/dashboard/volunteers/v/${data.volunteerId}${fromSource ? `?from=${encodeURIComponent(fromSource)}` : ""}`}
                  className="text-xs font-semibold text-blue-600 hover:underline"
                >
                  View all platforms combined →
                </Link>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {accounts.map((a) => {
                const isCurrent = !isVolunteerScope && a.id === account.id;
                return (
                  <Link
                    key={a.id}
                    href={accountProfileHref(a.handle, a.platform, isFromMatrix ? "matrix" : undefined)}
                    aria-current={isCurrent ? "page" : undefined}
                    className={`rounded-xl border px-3.5 py-3 transition hover:border-blue-300 ${
                      isCurrent ? "border-blue-300 bg-blue-50/50" : "border-slate-200 bg-slate-50/50"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <PlatformBadge platform={a.platform} />
                      <span className="text-xs text-slate-500">
                        {a.status === "active" ? "Active" : "Paused"}
                      </span>
                    </div>
                    <div className="mt-1.5 truncate font-mono text-xs text-blue-600">@{a.handle}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Followers: <strong className="text-slate-800">{formatMetric(a.followers)}</strong>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Monitored Posts */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Monitored Posts
            </span>
            <div className="rounded-lg bg-indigo-50 p-2">
              <Layers className="h-4 w-4 text-indigo-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">
              {metrics.totalMonitoredPosts}
            </span>
          </div>
          <span className="mt-1 block text-xs text-slate-500">
            {dateFilter === "today"
              ? "Recorded today"
              : dateFilter === "7d"
              ? "Past 7 days"
              : dateFilter === "180d"
              ? "Past 6 months"
              : dateFilter === "all"
              ? "All recorded history"
              : "Within 30-day window"}
          </span>
        </div>

        {/* Total Likes */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Total Likes
            </span>
            <div className="rounded-lg bg-rose-50 p-2">
              <Heart className="h-4 w-4 text-rose-500" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">
              {formatMetric(metrics.totalLikes)}
            </span>
          </div>
          <span className="mt-1 block text-xs text-slate-500" title="The dashboard leaderboard shows engagement GAINED in the period; this page shows each post's current total.">Current totals of posts published in this period</span>
        </div>

        {/* Total Comments */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Total Comments
            </span>
            <div className="rounded-lg bg-teal-50 p-2">
              <MessageCircle className="h-4 w-4 text-teal-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">
              {formatMetric(metrics.totalComments)}
            </span>
          </div>
          <span className="mt-1 block text-xs text-slate-500">Audience replies & discussions</span>
        </div>

        {/* Avg Engagement / Post */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wide">
              Avg Engagement / Post
            </span>
            <div className="rounded-lg bg-amber-50 p-2">
              <Sparkles className="h-4 w-4 text-amber-600" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">
              {formatMetric(metrics.avgEngagementPerPost)}
            </span>
          </div>
          <span className="mt-1 block text-xs text-slate-500">Likes + comments / post</span>
        </div>
      </div>

      {/* ── Engagement Timeline Chart ── */}
      {timeline.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Engagement Over Time</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Likes and comments trend across this volunteer’s posts
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1.5 text-blue-600">
                <span className="h-2 w-2 rounded-full bg-blue-600" /> Likes
              </span>
              <span className="flex items-center gap-1.5 text-emerald-600">
                <span className="h-2 w-2 rounded-full bg-emerald-600" /> Comments
              </span>
            </div>
          </div>
          <EngagementTrendChart data={timeline} />
        </div>
      )}

      {/* ── Actionable Monitored Posts Section ── */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Monitored Posts & Content</h2>
            <p className="text-xs text-slate-500">
              Showing {filteredPosts.length} of {posts.length} posts
            </p>
          </div>

          {/* Controls: Search, Filter, and Grid/Table toggle */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
              <input
                type="text"
                placeholder="Search caption..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-44 sm:w-56"
              />
            </div>

            {/* Platform filter (volunteer page combines several platforms) */}
            {isVolunteerScope && accounts.length > 1 && (
              <select
                value={platformFilter}
                onChange={(e) => setPlatformFilter(e.target.value)}
                aria-label="Filter by platform"
                className="text-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All platforms</option>
                {Array.from(new Set(accounts.map((a) => a.platform))).map((p) => (
                  <option key={p} value={p}>
                    {labelOf(p)}
                  </option>
                ))}
              </select>
            )}

            {/* Media Filter */}
            <select
              value={mediaFilter}
              onChange={(e) => setMediaFilter(e.target.value)}
              className="text-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Media</option>
              <option value="Image">Photos</option>
              <option value="Video">Videos / Reels</option>
              <option value="Sidecar">Carousels</option>
            </select>

            {/* View Mode Toggle */}
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              <button
                onClick={() => setViewMode("grid")}
                className={`p-1.5 rounded-md text-xs font-medium transition ${
                  viewMode === "grid"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
                title="Grid View"
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("table")}
                className={`p-1.5 rounded-md text-xs font-medium transition ${
                  viewMode === "table"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
                title="Table View"
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* ── View 1: Card Grid View ── */}
        {viewMode === "grid" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredPosts.length === 0 ? (
              <div className="col-span-full rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
                No posts match the filter.
              </div>
            ) : (
              filteredPosts.map((post) => (
                <div
                  key={post.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between"
                >
                  <div>
                    {/* Top row: Media type tag + Posted Date */}
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-3">
                      <span className="inline-flex items-center gap-1.5">
                        {isVolunteerScope && <PlatformBadge platform={post.platform} compact />}
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium">
                          {post.mediaType}
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {post.postedAt || "Recently"}
                      </span>
                    </div>

                    {/* Caption Preview */}
                    <p className="text-sm text-slate-800 font-normal leading-relaxed line-clamp-3 mb-4">
                      {post.caption || <span className="text-slate-500 italic">No caption provided</span>}
                    </p>
                  </div>

                  <div>
                    {/* Metrics Bar */}
                    <div className={`grid ${post.quotes !== null ? "grid-cols-4" : "grid-cols-3"} gap-2 py-3 px-3 rounded-xl bg-slate-50 border border-slate-100 mb-4 text-center`}>
                      <div>
                        <span className="flex items-center justify-center gap-1 text-xs font-medium text-slate-500">
                          <Heart className="h-3 w-3 text-rose-500" /> Likes
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {formatMetric(post.likes)}
                        </span>
                      </div>
                      <div>
                        <span className="flex items-center justify-center gap-1 text-xs font-medium text-slate-500">
                          <MessageCircle className="h-3 w-3 text-teal-600" /> Comments
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {formatMetric(post.comments)}
                        </span>
                      </div>
                      <div>
                        <span className="flex items-center justify-center gap-1 text-xs font-medium text-slate-500">
                          <Eye className="h-3 w-3 text-amber-500" /> Views
                        </span>
                        <span className="text-sm font-bold text-slate-900">
                          {formatMetric(post.views)}
                        </span>
                      </div>
                      {post.quotes !== null && (
                        <div>
                          <span className="flex items-center justify-center gap-1 text-xs font-medium text-slate-500">
                            <Quote className="h-3 w-3 text-violet-500" /> Quotes
                          </span>
                          <span className="text-sm font-bold text-slate-900">
                            {formatMetric(post.quotes)}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Actionable buttons: View on IG & Copy Link */}
                    <div className="flex items-center gap-2 pt-1 border-t border-slate-100">
                      {post.url ? (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 text-xs font-semibold transition"
                        >
                          {(() => {
                            const Icon = platformIcon(post.platform);
                            return <Icon className="h-3.5 w-3.5" />;
                          })()}
                          View on {labelOf(post.platform)}
                          <ExternalLink className="h-3 w-3 opacity-70" />
                        </a>
                      ) : (
                        <span className="flex-1 text-center text-xs text-slate-500 py-2">
                          Link unavailable
                        </span>
                      )}

                      {post.url && (
                        <button
                          onClick={() => handleCopy(post.url, post.id)}
                          className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition"
                          title="Copy direct post link"
                        >
                          {copiedLink === post.id ? (
                            <Check className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── View 2: Actionable Data Table View ── */}
        {viewMode === "table" && (
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-600">
                <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3">Caption</th>
                    {isVolunteerScope && <th className="px-6 py-3">Account</th>}
                    <th className="px-6 py-3">Type</th>
                    <th className="px-6 py-3">Posted Date</th>
                    <th className="px-6 py-3 text-right">Likes</th>
                    <th className="px-6 py-3 text-right">Comments</th>
                    <th className="px-6 py-3 text-right">Views</th>
                    <th className="px-6 py-3 text-right">Quotes</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredPosts.length === 0 ? (
                    <tr>
                      <td colSpan={isVolunteerScope ? 9 : 8} className="px-6 py-10 text-center text-sm text-slate-500">
                        No posts found matching filter.
                      </td>
                    </tr>
                  ) : (
                    filteredPosts.map((post) => (
                      <tr key={post.id} className="hover:bg-slate-50 transition">
                        <td className="px-6 py-3.5 max-w-sm truncate text-slate-900 font-normal" title={post.caption || ""}>
                          {post.caption || <span className="text-slate-500 italic">No caption</span>}
                        </td>
                        {isVolunteerScope && (
                          <td className="px-6 py-3.5 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <PlatformBadge platform={post.platform} compact />
                              <span className="font-mono text-xs text-slate-600">@{post.handle}</span>
                            </div>
                          </td>
                        )}
                        <td className="px-6 py-3.5">
                          <span className="text-xs px-2 py-0.5 rounded bg-slate-100 font-medium text-slate-600">
                            {post.mediaType}
                          </span>
                        </td>
                        <td className="px-6 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                          {post.postedAt}
                        </td>
                        <td className="px-6 py-3.5 text-right font-semibold text-rose-600">
                          {formatMetric(post.likes)}
                        </td>
                        <td className="px-6 py-3.5 text-right font-semibold text-teal-600">
                          {formatMetric(post.comments)}
                        </td>
                        <td className="px-6 py-3.5 text-right font-medium text-slate-600">
                          {formatMetric(post.views)}
                        </td>
                        <td className="px-6 py-3.5 text-right font-medium text-slate-600">
                          {formatMetric(post.quotes)}
                        </td>
                        <td className="px-6 py-3.5 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {post.url ? (
                              <a
                                href={post.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 font-medium transition"
                              >
                                View <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null}

                            {post.url && (
                              <button
                                onClick={() => handleCopy(post.url, post.id)}
                                className="p-1 rounded text-slate-500 hover:text-slate-700 transition"
                                title="Copy link"
                              >
                                {copiedLink === post.id ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
