"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Grid, BarChart3 } from "lucide-react";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { DayCoverageView } from "@/components/matrix/DayCoverageView";
import { CampaignAnalyticsView } from "@/components/analytics/CampaignAnalyticsView";
import type { DayCoverageData } from "@/lib/supabase/matrix";
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
  /** Set when the server could not load the data; the numbers below are then NOT real zeros. */
  loadError?: string | null;
  /** Loaded only while the coverage tab is showing. */
  dayCoverage: DayCoverageData | null;
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

export function DashboardTabs({ dayCoverage, analyticsData, loadError }: DashboardTabsProps) {
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
          <div className="flex w-full items-center rounded-xl border border-slate-200 bg-slate-200/60 p-1 sm:w-auto" role="tablist" aria-label="Dashboard view">
            {([
              { id: "matrix", label: "Caption coverage", Icon: Grid },
              { id: "analytics", label: "Trends & rankings", Icon: BarChart3 },
            ] as const).map(({ id, label, Icon }) => (
              <button
                key={id}
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => handleTabChange(id)}
                className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold transition-colors sm:flex-none sm:px-4 sm:text-sm ${
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
      {loadError ? (
        <ErrorState
          title="Couldn't load the dashboard data"
          message="The numbers can't be shown right now, and zeros would be misleading. Reload the page to try again."
          detail={loadError}
          onRetry={() => router.refresh()}
        />
      ) : activeTab === "matrix" ? (
        // Still loading after a tab switch: the server has not sent this tab's data yet.
        dayCoverage ? <DayCoverageView data={dayCoverage} /> : <div className="p-10 text-center text-sm text-slate-500">Loading...</div>
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
