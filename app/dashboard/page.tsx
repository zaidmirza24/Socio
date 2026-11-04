import { Users, Layers, Heart, MessageCircle, ArrowUpRight } from "lucide-react";
import { EngagementTrendChart, type TrendDataPoint } from "@/components/charts/EngagementTrendChart";

// Demo/initial data for UI preview before live Supabase population
const sampleTrend: TrendDataPoint[] = [
  { date: "Oct 29", likes: 820, comments: 120 },
  { date: "Oct 30", likes: 940, comments: 145 },
  { date: "Oct 31", likes: 1100, comments: 180 },
  { date: "Nov 01", likes: 1250, comments: 210 },
  { date: "Nov 02", likes: 1420, comments: 240 },
  { date: "Nov 03", likes: 1680, comments: 310 },
  { date: "Nov 04", likes: 1890, comments: 350 },
];

const sampleLeaderboard = [
  { rank: 1, handle: "volunteer_alice", name: "Alice Volunteer", posts: 10, totalLikes: 1420, totalComments: 180, followers: 1250 },
  { rank: 2, handle: "volunteer_bob", name: "Bob Builder", posts: 9, totalLikes: 980, totalComments: 94, followers: 980 },
  { rank: 3, handle: "volunteer_charlie", name: "Charlie Green", posts: 8, totalLikes: 840, totalComments: 76, followers: 750 },
  { rank: 4, handle: "volunteer_diana", name: "Diana Prince", posts: 10, totalLikes: 790, totalComments: 88, followers: 1100 },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      {/* Page Title & Scope Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Campaign Overview
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Phase 1 Instagram scope: 30 active accounts, up to 10 recent posts each.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs bg-slate-200 text-slate-700 font-medium px-3 py-1 rounded-md">
            Schedule: Daily 8:00 AM IST
          </span>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Tracked Accounts</span>
            <Users className="h-5 w-5 text-blue-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">30</span>
            <span className="text-xs font-medium text-emerald-600 flex items-center">
              100% active
            </span>
          </div>
          <span className="mt-1 block text-xs text-slate-400">Instagram Volunteer Accounts</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Monitored Posts</span>
            <Layers className="h-5 w-5 text-indigo-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">286</span>
            <span className="text-xs font-medium text-slate-500 flex items-center">
              Up to 10 / account
            </span>
          </div>
          <span className="mt-1 block text-xs text-slate-400">Published in last 30 days</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Total Likes</span>
            <Heart className="h-5 w-5 text-rose-500" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">12,450</span>
            <span className="text-xs font-medium text-emerald-600 flex items-center">
              <ArrowUpRight className="h-3.5 w-3.5" /> +14.2%
            </span>
          </div>
          <span className="mt-1 block text-xs text-slate-400">Day-over-day growth</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-500">Total Comments</span>
            <MessageCircle className="h-5 w-5 text-teal-600" />
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-3xl font-bold text-slate-900">1,820</span>
            <span className="text-xs font-medium text-emerald-600 flex items-center">
              <ArrowUpRight className="h-3.5 w-3.5" /> +8.5%
            </span>
          </div>
          <span className="mt-1 block text-xs text-slate-400">Engagement interaction</span>
        </div>
      </div>

      {/* Engagement Trend Chart */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Daily Engagement Trend</h2>
            <p className="text-xs text-slate-500">Aggregated likes and comments across monitored posts</p>
          </div>
          <div className="flex items-center gap-4 text-xs font-medium">
            <span className="flex items-center gap-1.5 text-blue-600">
              <span className="h-2 w-2 rounded-full bg-blue-600"></span> Likes
            </span>
            <span className="flex items-center gap-1.5 text-emerald-600">
              <span className="h-2 w-2 rounded-full bg-emerald-600"></span> Comments
            </span>
          </div>
        </div>

        <EngagementTrendChart data={sampleTrend} />
      </div>

      {/* Volunteer Leaderboard */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Volunteer Leaderboard</h2>
          <span className="text-xs text-slate-400">Ranked by overall campaign engagement</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Rank</th>
                <th className="px-6 py-3">Volunteer</th>
                <th className="px-6 py-3">Instagram Handle</th>
                <th className="px-6 py-3 text-right">Posts</th>
                <th className="px-6 py-3 text-right">Followers</th>
                <th className="px-6 py-3 text-right">Total Likes</th>
                <th className="px-6 py-3 text-right">Total Comments</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {sampleLeaderboard.map((item) => (
                <tr key={item.handle} className="hover:bg-slate-50 transition">
                  <td className="px-6 py-4 font-semibold text-slate-900">#{item.rank}</td>
                  <td className="px-6 py-4 font-medium text-slate-900">{item.name}</td>
                  <td className="px-6 py-4 text-blue-600">@{item.handle}</td>
                  <td className="px-6 py-4 text-right font-medium">{item.posts}</td>
                  <td className="px-6 py-4 text-right">{item.followers.toLocaleString()}</td>
                  <td className="px-6 py-4 text-right text-rose-600 font-medium">
                    {item.totalLikes.toLocaleString()}
                  </td>
                  <td className="px-6 py-4 text-right text-teal-600 font-medium">
                    {item.totalComments.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

