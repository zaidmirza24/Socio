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
import { getDayCoverage, type DayCoverageData } from "@/lib/supabase/matrix";
import { parseDay } from "@/lib/coverage/day-coverage";
import { formatDate } from "@/lib/utils";
import { parsePlatformFilter } from "@/lib/platform";
import { DashboardTabs } from "@/components/dashboard/DashboardTabs";

export const dynamic = "force-dynamic";

interface DashboardPageProps {
  searchParams: Promise<{ range?: string; platform?: string; view?: string; tab?: string; day?: string }>;
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const resolvedParams = await searchParams;
  const rawRange = resolvedParams?.range;
  const range: DateRangePreset =
    rawRange === "today" || rawRange === "7d" || rawRange === "30d" || rawRange === "180d" || rawRange === "all"
      ? rawRange
      : "today";

  const platform = parsePlatformFilter(resolvedParams?.platform);

  // Same rule as DashboardTabs: only one tab is on screen, so only its data is loaded. Switching
  // the viewed day then re-runs one coverage query instead of every analytics query.
  const view = resolvedParams?.view;
  const wantAnalytics = view === "analytics" || (!!resolvedParams?.tab && view !== "matrix");
  const day = parseDay(resolvedParams?.day) ?? formatDate(new Date());

  let dayCoverage: DayCoverageData | null = null;

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

  let loadError: string | null = null;

  try {
    if (!wantAnalytics) {
      dayCoverage = await getDayCoverage(day);
    } else {
      const [trend, top, volEng, volRank, accComp, lead, kpiData, posts] = await Promise.all([
        getDailyEngagementTrend(range, platform),
        getTopPosts(range, platform),
        getVolunteerEngagement(range, platform),
        getVolunteerRanking(range, platform),
        getAccountComparison(range, platform),
        getVolunteerLeaderboard(range, platform),
        getKPISummary(range, platform),
        // Highest engagement in the period (ranked in SQL order over up to 1,000 posts), not just the
        // newest 60: an older post with strong engagement must still show up as a top post.
        getRecentMonitoredPosts(60, range, platform, "engagement"),
      ]);

      trendData = trend;
      topPosts = top;
      volunteerEngagement = volEng;
      volunteerRanking = volRank;
      accountComparison = accComp;
      leaderboard = lead;
      kpi = kpiData;
      recentPosts = posts;
    }
  } catch (err) {
    console.error("[DashboardPage] Failed to load dashboard data:", err);
    loadError = err instanceof Error ? err.message : "Failed to load dashboard data";
  }

  return (
    <DashboardTabs
      loadError={loadError}
      dayCoverage={dayCoverage}
      analyticsData={{
        currentRange: range,
        platform,
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
