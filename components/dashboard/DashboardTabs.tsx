"use client";

import React, { useState } from "react";
import { Grid, BarChart3, HelpCircle } from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<"matrix" | "analytics">("matrix");

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      {/* Header and View Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Volunteer Campaign Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Real-time tracking of canonical campaign content published by verified volunteer accounts.
          </p>
        </div>

        {/* Tab Toggle */}
        <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start sm:self-auto border border-slate-200/80">
          <button
            onClick={() => setActiveTab("matrix")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
              activeTab === "matrix"
                ? "bg-white text-blue-600 shadow-sm"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Grid className="h-4 w-4" />
            <span>Volunteers &times; Captions Matrix</span>
          </button>

          <button
            onClick={() => setActiveTab("analytics")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-semibold transition ${
              activeTab === "analytics"
                ? "bg-white text-blue-600 shadow-sm"
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

