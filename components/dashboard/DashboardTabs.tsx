"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Grid, BarChart3 } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
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
  PlatformFilter,
} from "@/lib/supabase/queries";

interface DashboardTabsProps {
  matrixData: MatrixData;
  analyticsData: {
    currentRange: DateRangePreset;
    platform: PlatformFilter;
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
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Every post from monitored volunteer accounts on Instagram, Facebook and X, with engagement over time."
        actions={
          <div className="flex items-center rounded-xl border border-slate-200 bg-slate-200/60 p-1" role="tablist" aria-label="Dashboard view">
            {([
              { id: "matrix", label: "Caption matrix", Icon: Grid },
              { id: "analytics", label: "Trends & rankings", Icon: BarChart3 },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => handleTabChange(id)}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                  activeTab === id ? "bg-white text-blue-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        }
      />

      {/* Tab Content */}
      {activeTab === "matrix" ? (
        <VolunteersMatrixView data={matrixData} />
      ) : (
        <CampaignAnalyticsView
          currentRange={analyticsData.currentRange}
          platform={analyticsData.platform}
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
