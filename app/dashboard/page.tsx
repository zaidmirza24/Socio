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
import { getMatrixData, type MatrixData } from "@/lib/supabase/matrix";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";

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
      : "today";

  // Load Matrix Data and Analytics Data in parallel from Supabase
  let matrixData: MatrixData = {
    captions: [],
    rows: [],
    stats: {
      totalVolunteers: 0,
      activeCaptionsCount: 0,
      totalPosted: 0,
      totalPending: 0,
      totalNeedsReview: 0,
      totalNotVisible: 0,
      completionRate: 0,
    },
  };

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
    const [
      matrix,
      trend,
      top,
      volEng,
      volRank,
      accComp,
      lead,
      kpiData,
      posts,
    ] = await Promise.all([
      getMatrixData(),
      getDailyEngagementTrend(range),
      getTopPosts(range),
      getVolunteerEngagement(range),
      getVolunteerRanking(range),
      getAccountComparison(range),
      getVolunteerLeaderboard(range),
      getKPISummary(range),
      getRecentMonitoredPosts(60, range),
    ]);

    matrixData = matrix;
    trendData = trend;
    topPosts = top;
    volunteerEngagement = volEng;
    volunteerRanking = volRank;
    accountComparison = accComp;
    leaderboard = lead;
    kpi = kpiData;
    recentPosts = posts;
  } catch (err) {
    console.error("[DashboardPage] Failed to load dashboard data:", err);
  }

  return (
    <DashboardTabs
      matrixData={matrixData}
      analyticsData={{
        currentRange: range,
        trendData,
        topPosts,
        volunteerEngagement,
        volunteerRanking,
        accountComparison,
        leaderboard,
        kpi,
        recentPosts,
      }}
    />
  );
}
