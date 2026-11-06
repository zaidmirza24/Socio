import {
  getDailyEngagementTrend,
  getTopPosts,
  getVolunteerEngagement,
  getVolunteerRanking,
  getAccountComparison,
  getVolunteerLeaderboard,
  getKPISummary,
  getRecentMonitoredPosts,
  type DateRangePreset,
  type TrendDataPoint,
  type TopPostData,
  type VolunteerEngagementData,
  type VolunteerRankingPoint,
  type AccountPerformance,
  type LeaderboardEntry,
  type KPISummary,
  type RecentPostItem,
} from "@/lib/supabase/queries";
import { CampaignAnalyticsView } from "@/components/analytics/CampaignAnalyticsView";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedParams = await searchParams;
  const rawRange = resolvedParams?.range;
  const range: DateRangePreset =
    rawRange === "today" || rawRange === "7d" || rawRange === "30d" || rawRange === "180d" || rawRange === "all"
      ? rawRange
      : "30d";

  // Load all chart + table + KPI + post data in parallel from Supabase for the selected range
  let trendData: TrendDataPoint[] = [];
  let topPosts: TopPostData[] = [];
  let volunteerEngagement: VolunteerEngagementData[] = [];
  let volunteerRanking: VolunteerRankingPoint[] = [];
  let accountComparison: AccountPerformance[] = [];
  let leaderboard: LeaderboardEntry[] = [];
  let recentPosts: RecentPostItem[] = [];
  let kpi: KPISummary = {
    totalAccounts: 0,
    activeAccounts: 0,
    totalPosts: 0,
    totalLikes: 0,
    totalComments: 0,
    totalViews: 0,
  };

  try {
    [
      trendData,
      topPosts,
      volunteerEngagement,
      volunteerRanking,
      accountComparison,
      leaderboard,
      kpi,
      recentPosts,
    ] = await Promise.all([
      getDailyEngagementTrend(range),
      getTopPosts(range),
      getVolunteerEngagement(range),
      getVolunteerRanking(range),
      getAccountComparison(range),
      getVolunteerLeaderboard(range),
      getKPISummary(range),
      getRecentMonitoredPosts(60, range),
    ]);
  } catch (err) {
    console.error("[DashboardPage] Failed to load analytics:", err);
  }

  return (
    <CampaignAnalyticsView
      currentRange={range}
      trendData={trendData}
      topPosts={topPosts}
      volunteerEngagement={volunteerEngagement}
      volunteerRanking={volunteerRanking}
      accountComparison={accountComparison}
      leaderboard={leaderboard}
      kpi={kpi}
      recentPosts={recentPosts}
    />
  );
}
