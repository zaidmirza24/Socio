"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Grid, BarChart3 } from "lucide-react";
import { VolunteersMatrixView } from "@/components/matrix/VolunteersMatrixView";
import { CampaignAnalyticsView } from "@/components/analytics/CampaignAnalyticsView";
import type { MatrixData } from "@/lib/supabase/matrix";
import type {
  TrendDataPoint,
  TopPostData,
  VolunteerEngagementData,
  VolunteerRankingPoint,
  AccountPerformance,
  LeaderboardEntry,
  KPISummary,
  RecentPostItem,
  DateRangePreset,
} from "@/lib/supabase/queries";

interface DashboardTabsProps {
  matrixData: MatrixData;
  analyticsData: {
    currentRange: DateRangePreset;
    trendData: TrendDataPoint[];
    topPosts: TopPostData[];
    volunteerEngagement: VolunteerEngagementData[];
    volunteerRanking: VolunteerRankingPoint[];
    accountComparison: AccountPerformance[];
    leaderboard: LeaderboardEntry[];
    kpi: KPISummary;
    recentPosts: RecentPostItem[];
  };
}

export function DashboardTabs({ matrixData, analyticsData }: DashboardTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // If view is 'analytics' or tab is specified, activate analytics tab
  const viewParam = searchParams.get("view");
  const tabParam = searchParams.get("tab");
  const activeTab: "matrix" | "analytics" =
    viewParam === "analytics" || (tabParam && viewParam !== "matrix")
      ? "analytics"
      : "matrix";

  const handleTabChange = (nextTab: "matrix" | "analytics") => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", nextTab);
    if (nextTab === "matrix") {
      params.delete("tab");
    }
    router.replace(`/dashboard?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header and View Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Volunteer Campaign Dashboard
            </h1>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
              {activeTab === "matrix" ? "Live Matrix View" : "Analytics & Trends"}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Real-time tracking of canonical campaign content published by verified volunteer accounts.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex items-center bg-slate-200/60 p-1 rounded-xl self-start sm:self-auto border border-slate-200">
          <button
            onClick={() => handleTabChange("matrix")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
              activeTab === "matrix"
                ? "bg-white text-blue-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Grid className="h-4 w-4" />
            <span>Volunteers &times; Captions Matrix</span>
          </button>

          <button
            onClick={() => handleTabChange("analytics")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all duration-150 ${
              activeTab === "analytics"
                ? "bg-white text-blue-700 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <BarChart3 className="h-4 w-4" />
            <span>Analytics &amp; Engagement Trends</span>
          </button>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "matrix" ? (
        <VolunteersMatrixView data={matrixData} />
      ) : (
        <CampaignAnalyticsView
          currentRange={analyticsData.currentRange}
          trendData={analyticsData.trendData}
          topPosts={analyticsData.topPosts}
          volunteerEngagement={analyticsData.volunteerEngagement}
          volunteerRanking={analyticsData.volunteerRanking}
          accountComparison={analyticsData.accountComparison}
          leaderboard={analyticsData.leaderboard}
          kpi={analyticsData.kpi}
          recentPosts={analyticsData.recentPosts}
        />
      )}
    </div>
  );
}
