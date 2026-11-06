"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import {
  Users,
  Layers,
  Heart,
  MessageCircle,
  Eye,
  Trophy,
  TrendingUp,
  Search,
  Filter,
  ExternalLink,
  Sparkles,
  BarChart3,
  Video,
  Image as ImageIcon,
  Compass,
  ArrowUpRight,
  Medal,
  CheckCircle2,
} from "lucide-react";

import { EngagementTrendChart, type TrendDataPoint } from "@/components/charts/EngagementTrendChart";
import { TopPostsChart, type TopPostData } from "@/components/charts/TopPostsChart";
import { DailyVolunteerRankingChart, type VolunteerRankingPoint } from "@/components/charts/DailyVolunteerRankingChart";
import { InstagramAccountComparisonChart, type AccountPerformance } from "@/components/charts/InstagramAccountComparisonChart";
import { DateRangeFilter } from "@/components/analytics/DateRangeFilter";
import { formatMetric, formatNumber } from "@/lib/utils";
import type {
  KPISummary,
  LeaderboardEntry,
  RecentPostItem,
  VolunteerEngagementData,
  DateRangePreset,
} from "@/lib/supabase/queries";

export interface CampaignAnalyticsViewProps {
  currentRange?: DateRangePreset;
  trendData: TrendDataPoint[];
  topPosts: TopPostData[];
  volunteerEngagement: VolunteerEngagementData[];
  volunteerRanking: VolunteerRankingPoint[];
  accountComparison: AccountPerformance[];
  leaderboard: LeaderboardEntry[];
  kpi: KPISummary;
  recentPosts: RecentPostItem[];
}

type ActiveTab = "overview" | "volunteers" | "content";
type MetricFilter = "all" | "likes" | "comments";

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-100 text-amber-800 font-bold text-sm shadow-xs border border-amber-200">
        🥇
      </span>
    );
  }
  if (rank === 2) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-700 font-bold text-sm shadow-xs border border-slate-200">
        🥈
      </span>
    );
  }
  if (rank === 3) {
    return (
      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-orange-100 text-orange-800 font-bold text-sm shadow-xs border border-orange-200">
        🥉
      </span>
    );
  }
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-slate-600 font-semibold text-xs border border-slate-200">
      #{rank}
    </span>
  );
}

function SectionCard({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-xs">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

export function CampaignAnalyticsView({
  currentRange = "30d",
  trendData,
  topPosts,
  volunteerRanking,
  accountComparison,
  leaderboard,
  kpi,
  recentPosts,
}: CampaignAnalyticsViewProps) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [trendMetric, setTrendMetric] = useState<MetricFilter>("all");
  const [searchVolunteer, setSearchVolunteer] = useState("");
  const [sortLeaderboardBy, setSortLeaderboardBy] = useState<
    "rank" | "engagement" | "likes" | "comments" | "posts" | "followers"
  >("rank");
  const [volunteerDisplayMode, setVolunteerDisplayMode] = useState<"table" | "comparison">("table");
  const [mediaTypeFilter, setMediaTypeFilter] = useState<string>("all");

  const activePct =
    kpi.totalAccounts > 0
      ? Math.round((kpi.activeAccounts / kpi.totalAccounts) * 100)
      : 100;

  const totalEngagement = kpi.totalLikes + kpi.totalComments;
  const avgEngagementPerPost =
    kpi.totalPosts > 0 ? Math.round(totalEngagement / kpi.totalPosts) : 0;

  const topVolunteer = leaderboard[0];

  // Filtered & sorted leaderboard
  const filteredLeaderboard = useMemo(() => {
    let list = leaderboard.filter(
      (item) =>
        item.volunteerName.toLowerCase().includes(searchVolunteer.toLowerCase()) ||
        item.handle.toLowerCase().includes(searchVolunteer.toLowerCase())
    );

    if (sortLeaderboardBy === "engagement") {
      list = [...list].sort((a, b) => b.totalEngagement - a.totalEngagement);
    } else if (sortLeaderboardBy === "likes") {
      list = [...list].sort((a, b) => b.totalLikes - a.totalLikes);
    } else if (sortLeaderboardBy === "comments") {
      list = [...list].sort((a, b) => b.totalComments - a.totalComments);
    } else if (sortLeaderboardBy === "followers") {
      list = [...list].sort((a, b) => b.followers - a.followers);
    } else if (sortLeaderboardBy === "posts") {
      list = [...list].sort((a, b) => b.posts - a.posts);
    } else {
      list = [...list].sort((a, b) => a.rank - b.rank);
    }

    return list;
  }, [leaderboard, searchVolunteer, sortLeaderboardBy]);

  const maxLeaderboardEngagement = useMemo(() => {
    return leaderboard.length > 0 ? Math.max(...leaderboard.map((e) => e.totalEngagement), 1) : 1;
  }, [leaderboard]);

  // Content format distribution
  const mediaFormatStats = useMemo(() => {
    const counts: Record<string, { count: number; likes: number; comments: number }> = {
      Reel: { count: 0, likes: 0, comments: 0 },
      Carousel: { count: 0, likes: 0, comments: 0 },
      Photo: { count: 0, likes: 0, comments: 0 },
    };

    for (const p of recentPosts) {
      const type =
        p.mediaType?.toLowerCase().includes("video") || p.mediaType?.toLowerCase().includes("reel")
          ? "Reel"
          : p.mediaType?.toLowerCase().includes("carousel") || p.mediaType?.toLowerCase().includes("album")
          ? "Carousel"
          : "Photo";

      if (!counts[type]) counts[type] = { count: 0, likes: 0, comments: 0 };
      counts[type].count += 1;
      counts[type].likes += p.likes ?? 0;
      counts[type].comments += p.comments ?? 0;
    }

    const total = recentPosts.length || 1;
    return Object.entries(counts).map(([type, stats]) => {
      const engagements = stats.likes + stats.comments;
      const avg = stats.count > 0 ? Math.round(engagements / stats.count) : 0;
      const pct = Math.round((stats.count / total) * 100);
      return { type, count: stats.count, pct, avgEngagement: avg };
    });
  }, [recentPosts]);

  // Filtered recent posts for Content tab
  const filteredPosts = useMemo(() => {
    let list = recentPosts;
    if (mediaTypeFilter !== "all") {
      list = list.filter((p) => {
        const type = (p.mediaType || "").toLowerCase();
        if (mediaTypeFilter === "reel") return type.includes("video") || type.includes("reel");
        if (mediaTypeFilter === "carousel") return type.includes("carousel") || type.includes("album");
        if (mediaTypeFilter === "photo") return !type.includes("video") && !type.includes("reel") && !type.includes("carousel") && !type.includes("album");
        return true;
      });
    }
    // Sort highest engagement first
    return [...list].sort(
      (a, b) => ((b.likes ?? 0) + (b.comments ?? 0)) - ((a.likes ?? 0) + (a.comments ?? 0))
    );
  }, [recentPosts, mediaTypeFilter]);

  return (
    <div className="space-y-6">
      {/* ── Top Header & Tab Navigation ── */}
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Campaign Analytics</h1>
          <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
            Phase 1 · Instagram · {kpi.totalAccounts} accounts monitored · {kpi.totalPosts} active posts
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter value={currentRange} />
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Daily Ingestion Active
          </span>
        </div>
      </div>

      {/* ── Tab Switcher Strip (Progressive Disclosure) ── */}
      <div className="flex border-b border-slate-200">
        <nav className="-mb-px flex space-x-6" aria-label="Tabs">
          <button
            onClick={() => setActiveTab("overview")}
            className={`flex items-center gap-2 pb-3 pt-1 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "overview"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
          >
            <Compass className="h-4 w-4" />
            Campaign Overview
          </button>

          <button
            onClick={() => setActiveTab("volunteers")}
            className={`flex items-center gap-2 pb-3 pt-1 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "volunteers"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
          >
            <Users className="h-4 w-4" />
            Volunteer Leaderboard
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                activeTab === "volunteers"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {leaderboard.length}
            </span>
          </button>

          <button
            onClick={() => setActiveTab("content")}
            className={`flex items-center gap-2 pb-3 pt-1 text-sm font-medium border-b-2 transition-colors cursor-pointer ${
              activeTab === "content"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
          >
            <Sparkles className="h-4 w-4" />
            Content & Creatives
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                activeTab === "content"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-slate-100 text-slate-600"
              }`}
            >
              {recentPosts.length}
            </span>
          </button>
        </nav>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: CAMPAIGN OVERVIEW
      ───────────────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* KPI Strip */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Accounts
                </span>
                <div className="rounded-lg bg-blue-50 p-2">
                  <Users className="h-4 w-4 text-blue-600" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{kpi.totalAccounts}</span>
                <span className="text-xs font-medium text-emerald-600">{activePct}% active</span>
              </div>
              <span className="mt-1 block text-xs text-slate-400">Instagram volunteers</span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Posts
                </span>
                <div className="rounded-lg bg-indigo-50 p-2">
                  <Layers className="h-4 w-4 text-indigo-600" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">{kpi.totalPosts}</span>
                <span className="text-xs font-medium text-slate-400">≤10 / account</span>
              </div>
              <span className="mt-1 block text-xs text-slate-400">
                {currentRange === "today"
                  ? "Recorded today"
                  : currentRange === "7d"
                  ? "Past 7 days"
                  : currentRange === "180d"
                  ? "Past 6 months"
                  : currentRange === "all"
                  ? "All recorded history"
                  : "Active 30-day window"}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Total Likes
                </span>
                <div className="rounded-lg bg-rose-50 p-2">
                  <Heart className="h-4 w-4 text-rose-500" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">
                  {formatNumber(kpi.totalLikes)}
                </span>
              </div>
              <span className="mt-1 block text-xs text-slate-400">Across monitored posts</span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Total Comments
                </span>
                <div className="rounded-lg bg-teal-50 p-2">
                  <MessageCircle className="h-4 w-4 text-teal-600" />
                </div>
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-slate-900">
                  {formatNumber(kpi.totalComments)}
                </span>
              </div>
              <span className="mt-1 block text-xs text-slate-400">Direct conversations</span>
            </div>
          </div>

          {/* Quick Insights Highlight Bar */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-linear-to-r from-amber-50 to-orange-50 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <Trophy className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-amber-700">
                  Top Contributor
                </span>
                <p className="truncate text-sm font-bold text-slate-900">
                  {topVolunteer ? (
                    <Link
                      href={`/dashboard/volunteers/${topVolunteer.handle}`}
                      className="hover:underline"
                    >
                      @{topVolunteer.handle} ({topVolunteer.volunteerName})
                    </Link>
                  ) : (
                    "No data yet"
                  )}
                </p>
                <p className="text-xs text-amber-800">
                  {topVolunteer ? `${formatNumber(topVolunteer.totalEngagement)} engagements` : ""}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-blue-200 bg-linear-to-r from-blue-50 to-indigo-50 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-blue-700">
                  Avg. Engagement / Post
                </span>
                <p className="text-sm font-bold text-slate-900">
                  {formatNumber(avgEngagementPerPost)} interactions
                </p>
                <p className="text-xs text-blue-800">Across {kpi.totalPosts} published posts</p>
              </div>
            </div>

            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-linear-to-r from-emerald-50 to-teal-50 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">
                  Account Coverage
                </span>
                <p className="text-sm font-bold text-slate-900">
                  {kpi.activeAccounts} of {kpi.totalAccounts} Active
                </p>
                <p className="text-xs text-emerald-800">100% automated via Apify</p>
              </div>
            </div>
          </div>

          {/* Daily Engagement Trend Chart with Interactive Filter */}
          <SectionCard
            title="Daily Engagement Trend"
            subtitle="Aggregated interaction volume over the past 30 days"
            action={
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs">
                <button
                  onClick={() => setTrendMetric("all")}
                  className={`rounded-md px-2.5 py-1 font-medium transition cursor-pointer ${
                    trendMetric === "all"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  All Metrics
                </button>
                <button
                  onClick={() => setTrendMetric("likes")}
                  className={`rounded-md px-2.5 py-1 font-medium transition cursor-pointer ${
                    trendMetric === "likes"
                      ? "bg-blue-600 text-white shadow-xs"
                      : "text-slate-500 hover:text-blue-600"
                  }`}
                >
                  Likes
                </button>
                <button
                  onClick={() => setTrendMetric("comments")}
                  className={`rounded-md px-2.5 py-1 font-medium transition cursor-pointer ${
                    trendMetric === "comments"
                      ? "bg-emerald-600 text-white shadow-xs"
                      : "text-slate-500 hover:text-emerald-600"
                  }`}
                >
                  Comments
                </button>
              </div>
            }
          >
            <EngagementTrendChart data={trendData} metricFilter={trendMetric} />
          </SectionCard>

          {/* Format Mix + Top Ranking Trend side-by-side */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SectionCard
              title="Content Format Breakdown"
              subtitle="Distribution and average engagement by Instagram media type"
            >
              <div className="space-y-4 pt-1">
                {mediaFormatStats.map((item) => (
                  <div key={item.type} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span className="flex items-center gap-1.5 text-slate-700">
                        {item.type === "Reel" && <Video className="h-3.5 w-3.5 text-indigo-500" />}
                        {item.type === "Carousel" && (
                          <Layers className="h-3.5 w-3.5 text-emerald-500" />
                        )}
                        {item.type === "Photo" && (
                          <ImageIcon className="h-3.5 w-3.5 text-blue-500" />
                        )}
                        {item.type}s ({item.count} posts)
                      </span>
                      <span className="text-slate-500">
                        {item.pct}% · avg{" "}
                        <strong className="text-slate-800">{item.avgEngagement}</strong> eng/post
                      </span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          item.type === "Reel"
                            ? "bg-indigo-500"
                            : item.type === "Carousel"
                            ? "bg-emerald-500"
                            : "bg-blue-500"
                        }`}
                        style={{ width: `${item.pct}%` }}
                      />
                    </div>
                  </div>
                ))}

                <div className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 border border-slate-100">
                  💡 <strong>Insight:</strong> Reels & video posts typically drive higher viral reach, while carousels generate higher saves and comment depth.
                </div>
              </div>
            </SectionCard>

            <SectionCard
              title="Daily Top Volunteer Ranking"
              subtitle="Rank position of the top performer over time (inverted: #1 at top)"
            >
              <DailyVolunteerRankingChart data={volunteerRanking} />
            </SectionCard>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: VOLUNTEER LEADERBOARD
      ───────────────────────────────────────────────────────────── */}
      {activeTab === "volunteers" && (
        <div className="space-y-6">
          {/* Top 3 Podium Highlights */}
          {leaderboard.length >= 3 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {/* Gold #1 */}
              <div className="relative overflow-hidden rounded-xl border border-amber-300 bg-linear-to-b from-amber-50/60 to-white p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🥇</span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 border border-amber-200">
                    Rank #1
                  </span>
                </div>
                <div className="mt-3">
                  <Link
                    href={`/dashboard/volunteers/${leaderboard[0].handle}`}
                    className="text-base font-bold text-slate-900 hover:text-blue-600 hover:underline block truncate"
                  >
                    {leaderboard[0].volunteerName}
                  </Link>
                  <span className="text-xs font-mono text-slate-500">@{leaderboard[0].handle}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-amber-100 pt-3 text-xs">
                  <div>
                    <span className="text-slate-400">Total Engagement</span>
                    <p className="text-base font-bold text-slate-900">
                      {formatNumber(leaderboard[0].totalEngagement)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Posts / Followers</span>
                    <p className="font-semibold text-slate-700">
                      {leaderboard[0].posts} · {formatNumber(leaderboard[0].followers)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Silver #2 */}
              <div className="relative overflow-hidden rounded-xl border border-slate-300 bg-linear-to-b from-slate-50/70 to-white p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🥈</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700 border border-slate-200">
                    Rank #2
                  </span>
                </div>
                <div className="mt-3">
                  <Link
                    href={`/dashboard/volunteers/${leaderboard[1].handle}`}
                    className="text-base font-bold text-slate-900 hover:text-blue-600 hover:underline block truncate"
                  >
                    {leaderboard[1].volunteerName}
                  </Link>
                  <span className="text-xs font-mono text-slate-500">@{leaderboard[1].handle}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 text-xs">
                  <div>
                    <span className="text-slate-400">Total Engagement</span>
                    <p className="text-base font-bold text-slate-900">
                      {formatNumber(leaderboard[1].totalEngagement)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Posts / Followers</span>
                    <p className="font-semibold text-slate-700">
                      {leaderboard[1].posts} · {formatNumber(leaderboard[1].followers)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Bronze #3 */}
              <div className="relative overflow-hidden rounded-xl border border-orange-200 bg-linear-to-b from-orange-50/40 to-white p-5 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">🥉</span>
                  <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-800 border border-orange-200">
                    Rank #3
                  </span>
                </div>
                <div className="mt-3">
                  <Link
                    href={`/dashboard/volunteers/${leaderboard[2].handle}`}
                    className="text-base font-bold text-slate-900 hover:text-blue-600 hover:underline block truncate"
                  >
                    {leaderboard[2].volunteerName}
                  </Link>
                  <span className="text-xs font-mono text-slate-500">@{leaderboard[2].handle}</span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 border-t border-orange-100 pt-3 text-xs">
                  <div>
                    <span className="text-slate-400">Total Engagement</span>
                    <p className="text-base font-bold text-slate-900">
                      {formatNumber(leaderboard[2].totalEngagement)}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Posts / Followers</span>
                    <p className="font-semibold text-slate-700">
                      {leaderboard[2].posts} · {formatNumber(leaderboard[2].followers)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Filter, Search & View Controls */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchVolunteer}
                onChange={(e) => setSearchVolunteer(e.target.value)}
                placeholder="Search volunteer name or handle..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-4 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-xs">
                <Filter className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-500 font-medium">Sort by:</span>
                <select
                  value={sortLeaderboardBy}
                  onChange={(e) =>
                    setSortLeaderboardBy(
                      e.target.value as "rank" | "engagement" | "likes" | "comments" | "posts" | "followers"
                    )
                  }
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 focus:outline-hidden"
                >
                  <option value="rank">Rank (#1 first)</option>
                  <option value="engagement">Highest Total Engagement</option>
                  <option value="likes">Most Likes</option>
                  <option value="comments">Most Comments</option>
                  <option value="followers">Most Followers</option>
                  <option value="posts">Most Posts</option>
                </select>
              </div>

              <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
                <button
                  onClick={() => setVolunteerDisplayMode("table")}
                  className={`rounded px-2.5 py-1 font-medium transition cursor-pointer ${
                    volunteerDisplayMode === "table"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Table
                </button>
                <button
                  onClick={() => setVolunteerDisplayMode("comparison")}
                  className={`rounded px-2.5 py-1 font-medium transition cursor-pointer ${
                    volunteerDisplayMode === "comparison"
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  Chart
                </button>
              </div>
            </div>
          </div>

          {/* Table View */}
          {volunteerDisplayMode === "table" ? (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-600">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-5 py-3 w-16">Rank</th>
                      <th className="px-5 py-3">Volunteer</th>
                      <th className="px-5 py-3 text-right">Posts</th>
                      <th className="px-5 py-3 text-right">Followers</th>
                      <th className="px-5 py-3 text-right">
                        <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                          <Heart className="h-3.5 w-3.5" /> Likes
                        </span>
                      </th>
                      <th className="px-5 py-3 text-right">
                        <span className="inline-flex items-center gap-1 text-teal-600 font-semibold">
                          <MessageCircle className="h-3.5 w-3.5" /> Comments
                        </span>
                      </th>
                      <th className="px-5 py-3 text-right">Engagement</th>
                      <th className="px-5 py-3 w-40 text-left">Relative Scale</th>
                      <th className="px-5 py-3 text-right">Profile</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredLeaderboard.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="px-6 py-12 text-center text-sm text-slate-400">
                          No volunteers found matching &quot;{searchVolunteer}&quot;.
                        </td>
                      </tr>
                    ) : (
                      filteredLeaderboard.map((item) => {
                        const relativePct = Math.round(
                          (item.totalEngagement / maxLeaderboardEngagement) * 100
                        );
                        return (
                          <tr key={item.handle} className="hover:bg-slate-50/80 transition-colors">
                            <td className="px-5 py-3.5">
                              <RankBadge rank={item.rank} />
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="font-semibold text-slate-900">
                                <Link
                                  href={`/dashboard/volunteers/${item.handle}`}
                                  className="hover:text-blue-600 hover:underline"
                                >
                                  {item.volunteerName}
                                </Link>
                              </div>
                              <span className="text-xs font-mono text-blue-600">@{item.handle}</span>
                            </td>
                            <td className="px-5 py-3.5 text-right font-medium text-slate-800">
                              {item.posts}
                            </td>
                            <td className="px-5 py-3.5 text-right text-slate-600">
                              {formatMetric(item.followers)}
                            </td>
                            <td className="px-5 py-3.5 text-right font-semibold text-rose-600">
                              {formatMetric(item.totalLikes)}
                            </td>
                            <td className="px-5 py-3.5 text-right font-semibold text-teal-600">
                              {formatMetric(item.totalComments)}
                            </td>
                            <td className="px-5 py-3.5 text-right font-bold text-slate-900">
                              {formatMetric(item.totalEngagement)}
                            </td>
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className="h-full rounded-full bg-blue-500 transition-all duration-300"
                                    style={{ width: `${relativePct}%` }}
                                  />
                                </div>
                                <span className="text-[11px] font-mono text-slate-400 w-8 text-right">
                                  {relativePct}%
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-3.5 text-right">
                              <Link
                                href={`/dashboard/volunteers/${item.handle}`}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 hover:text-blue-600 transition"
                              >
                                View
                                <ArrowUpRight className="h-3 w-3" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <SectionCard
              title="Instagram Account Comparison"
              subtitle="Comparison of posts, likes, comments, and views across top performing accounts"
            >
              <InstagramAccountComparisonChart data={accountComparison} />
            </SectionCard>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 3: CONTENT & CREATIVES
      ───────────────────────────────────────────────────────────── */}
      {activeTab === "content" && (
        <div className="space-y-6">
          {/* Top 10 Performing Posts Bar Chart */}
          <SectionCard
            title="Top 10 Performing Posts by Total Engagement"
            subtitle="Ranked across likes, comments, and video views"
          >
            <TopPostsChart data={topPosts} />
          </SectionCard>

          {/* Media Filter & Post Grid Header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-2">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Monitored Post Cards</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Detailed view of creatives published by volunteers with live metrics
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-500">Filter format:</span>
              <div className="flex rounded-md border border-slate-200 bg-slate-50 p-0.5 text-xs">
                {["all", "reel", "carousel", "photo"].map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setMediaTypeFilter(filter)}
                    className={`rounded px-2.5 py-1 capitalize transition cursor-pointer font-medium ${
                      mediaTypeFilter === filter
                        ? "bg-white text-slate-900 shadow-xs"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    {filter === "all" ? "All Posts" : `${filter}s`}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Visual Post Cards Grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPosts.length === 0 ? (
              <div className="col-span-full rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-400">
                No posts found for the selected filter.
              </div>
            ) : (
              filteredPosts.slice(0, 15).map((post) => {
                const totalPostEngagement = (post.likes ?? 0) + (post.comments ?? 0);
                const isVideo =
                  post.mediaType?.toLowerCase().includes("video") ||
                  post.mediaType?.toLowerCase().includes("reel");
                const isCarousel =
                  post.mediaType?.toLowerCase().includes("carousel") ||
                  post.mediaType?.toLowerCase().includes("album");

                return (
                  <div
                    key={post.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 bg-white p-5 shadow-xs hover:border-blue-300 transition-all hover:shadow-sm"
                  >
                    <div>
                      {/* Card Header: Author + Format badge */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <Link
                            href={`/dashboard/volunteers/${post.handle}`}
                            className="font-bold text-slate-900 hover:text-blue-600 hover:underline block truncate text-sm"
                          >
                            @{post.handle}
                          </Link>
                          <span className="text-[11px] text-slate-400 truncate block">
                            {post.volunteerName}
                          </span>
                        </div>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                            isVideo
                              ? "bg-indigo-50 text-indigo-700 border border-indigo-200"
                              : isCarousel
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-blue-50 text-blue-700 border border-blue-200"
                          }`}
                        >
                          {isVideo && <Video className="h-3 w-3" />}
                          {isCarousel && <Layers className="h-3 w-3" />}
                          {!isVideo && !isCarousel && <ImageIcon className="h-3 w-3" />}
                          {post.mediaType}
                        </span>
                      </div>

                      {/* Caption snippet */}
                      <p className="mt-3 text-xs text-slate-600 line-clamp-3 leading-relaxed">
                        {post.caption || <span className="italic text-slate-400">No caption provided</span>}
                      </p>
                    </div>

                    {/* Card Footer: Metrics & Instagram link */}
                    <div className="mt-5 border-t border-slate-100 pt-3">
                      <div className="flex items-center justify-between text-xs mb-3">
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-1 text-rose-600 font-medium">
                            <Heart className="h-3.5 w-3.5" />
                            {formatMetric(post.likes)}
                          </span>
                          <span className="flex items-center gap-1 text-teal-600 font-medium">
                            <MessageCircle className="h-3.5 w-3.5" />
                            {formatMetric(post.comments)}
                          </span>
                          {post.views !== null && post.views !== undefined && (
                            <span className="flex items-center gap-1 text-amber-600 font-medium">
                              <Eye className="h-3.5 w-3.5" />
                              {formatMetric(post.views)}
                            </span>
                          )}
                        </div>

                        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-800 text-[11px]">
                          {formatNumber(totalPostEngagement)} eng
                        </span>
                      </div>

                      <div className="flex items-center justify-between pt-1 text-[11px] text-slate-400">
                        <span>{post.postedAt || "Recently posted"}</span>
                        {post.url && (
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 font-medium"
                          >
                            Open Instagram
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

