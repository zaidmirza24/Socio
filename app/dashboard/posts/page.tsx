import Link from "next/link";
import { formatMetric } from "@/lib/utils";
import { accountProfileHref, volunteerProfileHref } from "@/lib/utils/volunteer-links";
import { ExternalLink, Heart, MessageCircle, Eye, Search } from "lucide-react";
import { getPostsPage, type PostsPageResult, type DateRangePreset } from "@/lib/supabase/queries";
import { DateRangeFilter } from "@/components/analytics/DateRangeFilter";
import { PlatformFilter } from "@/components/analytics/PlatformFilter";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { parsePlatformFilter } from "@/lib/platform";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type View = "all" | "campaign" | "review";
type Sort = "recent" | "engagement";

interface PostsPageProps {
  searchParams: Promise<{
    range?: string;
    platform?: string;
    view?: string;
    q?: string;
    sort?: string;
    page?: string;
  }>;
}

const RANGE_TEXT: Record<DateRangePreset, string> = {
  today: "today",
  "7d": "the last 7 days",
  "30d": "the last 30-day window",
  "180d": "the last 6 months",
  all: "all time",
};

export default async function PostsPage({ searchParams }: PostsPageProps) {
  const sp = await searchParams;
  const platform = parsePlatformFilter(sp?.platform);
  const range: DateRangePreset =
    sp?.range === "today" || sp?.range === "7d" || sp?.range === "30d" || sp?.range === "180d" || sp?.range === "all"
      ? sp.range
      : "today";
  const view: View = sp?.view === "campaign" || sp?.view === "review" ? sp.view : "all";
  const sort: Sort = sp?.sort === "engagement" ? "engagement" : "recent";
  const search = (sp?.q ?? "").trim().slice(0, 80);
  const pageNum = Math.max(parseInt(sp?.page ?? "1", 10) || 1, 1);

  let result: PostsPageResult = { posts: [], total: 0, page: pageNum, pageSize: PAGE_SIZE, sortCapped: false };
  let loadError: string | null = null;
  try {
    result = await getPostsPage({ range, platform, view, search, sort, page: pageNum, pageSize: PAGE_SIZE });
  } catch (err) {
    console.error("[PostsPage] Failed to fetch posts:", err);
    loadError = err instanceof Error ? err.message : "Failed to load posts";
  }

  const { posts, total } = result;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const buildUrl = (overrides: Partial<{ view: View; sort: Sort; page: number }>) => {
    const params = new URLSearchParams();
    if (range !== "today") params.set("range", range);
    if (platform !== "all") params.set("platform", platform);
    const v = overrides.view ?? view;
    if (v !== "all") params.set("view", v);
    const so = overrides.sort ?? sort;
    if (so !== "recent") params.set("sort", so);
    if (search) params.set("q", search);
    const pg = overrides.page ?? 1;
    if (pg > 1) params.set("page", String(pg));
    const qs = params.toString();
    return `/dashboard/posts${qs ? `?${qs}` : ""}`;
  };

  const pill = (active: boolean, tone = "text-slate-900") =>
    `px-2.5 py-1 rounded-md transition ${active ? `bg-white ${tone} shadow-sm font-semibold` : "text-slate-600 hover:text-slate-900"}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Posts"
        badge={`${total.toLocaleString("en-IN")} posts`}
        description={`Posts published ${RANGE_TEXT[range]} on Instagram, Facebook and X, with their latest likes, comments and views.`}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <PlatformFilter value={platform} />

          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
            <Link href={buildUrl({ view: "all" })} className={pill(view === "all")}>
              All posts
            </Link>
            <Link href={buildUrl({ view: "campaign" })} className={pill(view === "campaign", "text-emerald-700")}>
              Campaign posts
            </Link>
            <Link href={buildUrl({ view: "review" })} className={pill(view === "review", "text-amber-700")}>
              Needs review
            </Link>
          </div>

          <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-xs font-medium">
            <Link href={buildUrl({ sort: "recent" })} className={pill(sort === "recent")}>
              Newest
            </Link>
            <Link href={buildUrl({ sort: "engagement" })} className={pill(sort === "engagement")}>
              Most engagement
            </Link>
          </div>

          <DateRangeFilter value={range} />
        </div>

        {/* Search (plain GET form so it works without client JS and keeps the other filters) */}
        <form method="get" action="/dashboard/posts" className="relative max-w-md">
          {range !== "today" && <input type="hidden" name="range" value={range} />}
          {platform !== "all" && <input type="hidden" name="platform" value={platform} />}
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          {sort !== "recent" && <input type="hidden" name="sort" value={sort} />}
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="Search caption, volunteer or handle..."
            aria-label="Search posts"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </form>
      </PageHeader>

      {loadError && (
        <ErrorState
          title="Couldn't load posts"
          message="The list can't be shown right now. Reload the page to try again."
          detail={loadError}
        >
          <a href="" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Reload page
          </a>
        </ErrorState>
      )}

      {result.sortCapped && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Engagement sorting covers the newest 1,000 matching posts. Narrow the date range or platform to rank all of
          them.
        </div>
      )}

      {!loadError && (
      <div className="rounded-xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/90 text-xs uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Volunteer</th>
                <th className="px-5 py-3.5">Platform</th>
                <th className="px-5 py-3.5">Caption</th>
                <th className="px-5 py-3.5">Format</th>
                <th className="px-5 py-3.5">Published</th>
                <th className="px-5 py-3.5 text-right">Likes</th>
                <th className="px-5 py-3.5 text-right">Comments</th>
                <th className="px-5 py-3.5 text-right">Views</th>
                <th className="px-5 py-3.5 text-right"><span className="sr-only">Link</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {posts.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-16 text-center text-slate-500">
                    <p className="text-sm font-medium text-slate-700">No posts found for this filter.</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Try another platform, date range or search. New posts appear after someone runs “Collect data”.
                    </p>
                  </td>
                </tr>
              ) : (
                posts.map((post) => (
                  <tr key={post.id} className="hover:bg-blue-50/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <Link
                        href={accountProfileHref(post.handle, post.platform)}
                        className="font-semibold text-slate-900 hover:text-blue-600 text-xs block transition"
                      >
                        @{post.handle}
                      </Link>
                      {post.volunteerName && post.volunteerName !== post.handle && (
                        <Link
                          href={volunteerProfileHref({ volunteerId: post.volunteerId, handle: post.handle, platform: post.platform })}
                          className="block text-xs text-slate-500 truncate max-w-[160px] hover:text-blue-600 hover:underline"
                          title="All of this volunteer's platforms"
                        >
                          {post.volunteerName}
                        </Link>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <PlatformBadge platform={post.platform} />
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 max-w-xs truncate" title={post.caption || ""}>
                      {post.matchStatus === "matched" && (
                        <span className="mr-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
                          Campaign
                        </span>
                      )}
                      {post.matchStatus === "needs_review" && (
                        <Link
                          href="/dashboard/review"
                          className="mr-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-700 border border-amber-200 hover:bg-amber-100"
                        >
                          Needs review
                        </Link>
                      )}
                      {post.matchStatus === "rejected" && (
                        <span
                          className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600 border border-slate-200"
                          title="An admin rejected this caption match. The post and its history are kept but no longer refreshed."
                        >
                          Rejected
                        </span>
                      )}
                      {post.caption || <span className="text-slate-500 italic">No caption</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-xs px-2 py-0.5 rounded-md bg-slate-100 font-semibold uppercase text-slate-600">
                        {post.mediaType}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-500 whitespace-nowrap tabular-nums">{post.postedAt}</td>
                    <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                      <span className="inline-flex items-center gap-1 text-rose-600 font-semibold">
                        <Heart className="h-3 w-3" />
                        {formatMetric(post.likes)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                      <span className="inline-flex items-center gap-1 text-teal-600 font-semibold">
                        <MessageCircle className="h-3 w-3" />
                        {formatMetric(post.comments)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-mono tabular-nums">
                      <span className="inline-flex items-center gap-1 text-slate-500 font-medium">
                        <Eye className="h-3 w-3" />
                        {formatMetric(post.views)}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {post.url ? (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition"
                        >
                          <span>Open post</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-500">n/a</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <Pagination page={pageNum} pageSize={PAGE_SIZE} total={total} hrefFor={(n) => buildUrl({ page: n })} />
      </div>
      )}
    </div>
  );
}
