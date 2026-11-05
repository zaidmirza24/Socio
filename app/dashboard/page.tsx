import {
  getDailyEngagementTrend,
  getTopPosts,
  getVolunteerEngagement,
  getVolunteerRanking,
  getAccountComparison,
  getVolunteerLeaderboard,
  getKPISummary,
  getRecentMonitoredPosts,
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

export default async function DashboardPage() {
  // Load all chart + table + KPI + post data in parallel from Supabase
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
      getDailyEngagementTrend(),
      getTopPosts(),
      getVolunteerEngagement(),
      getVolunteerRanking(),
      getAccountComparison(),
      getVolunteerLeaderboard(),
      getKPISummary(),
      getRecentMonitoredPosts(60),
    ]);
  } catch (err) {
    console.error("[DashboardPage] Failed to load analytics:", err);
  }

  return (
    <CampaignAnalyticsView
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
