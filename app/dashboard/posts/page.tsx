import Link from "next/link";
import { formatMetric } from "@/lib/utils";
import { ExternalLink, Heart, MessageCircle, Eye } from "lucide-react";
import { getRecentMonitoredPosts, type RecentPostItem, type DateRangePreset } from "@/lib/supabase/queries";
import { DateRangeFilter } from "@/components/analytics/DateRangeFilter";

export const dynamic = "force-dynamic";

interface PostsPageProps {
  searchParams: Promise<{ range?: string }>;
}

export default async function PostsPage({ searchParams }: PostsPageProps) {
  const resolvedParams = await searchParams;
  const rawRange = resolvedParams?.range;
  const range: DateRangePreset =
    rawRange === "today" || rawRange === "7d" || rawRange === "30d" || rawRange === "180d" || rawRange === "all"
      ? rawRange
      : "today";

  let posts: RecentPostItem[] = [];
  try {
    posts = await getRecentMonitoredPosts(100, range);
  } catch (err) {
    console.error("[PostsPage] Failed to fetch posts:", err);
  }

  const rangeText =
    range === "today"
      ? "today"
      : range === "7d"
      ? "the last 7 days"
      : range === "180d"
      ? "the last 6 months"
      : range === "all"
      ? "all time"
      : "the last 30-day window";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Recent Monitored Posts
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Posts published within {rangeText} (up to 10 per account) — {posts.length} posts recorded.
          </p>
        </div>
        <div className="flex items-center">
          <DateRangeFilter value={range} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-slate-600">
            <thead className="bg-slate-50 text-xs uppercase font-semibold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3">Account</th>
                <th className="px-6 py-3">Caption</th>
                <th className="px-6 py-3">Type</th>
                <th className="px-6 py-3">Posted Date</th>
                <th className="px-6 py-3 text-right">Likes</th>
                <th className="px-6 py-3 text-right">Comments</th>
                <th className="px-6 py-3 text-right">Views</th>
                <th className="px-6 py-3 text-right">Link</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {posts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400">
                    No posts found in database yet. Trigger a scrape to populate posts.
                  </td>
                </tr>
              ) : (
                posts.map((post) => (
                  <tr key={post.id} className="hover:bg-slate-50 transition">
                    <td className="px-6 py-4 font-semibold text-blue-600">
                      <Link
                        href={`/dashboard/volunteers/${post.handle}`}
                        className="hover:underline block"
                      >
                        @{post.handle}
                      </Link>
                      {post.volunteerName && post.volunteerName !== post.handle && (
                        <div className="text-xs font-normal text-slate-400">{post.volunteerName}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-slate-700 max-w-xs truncate" title={post.caption || ""}>
                      {post.caption || <span className="text-slate-400 italic">No caption</span>}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-xs px-2 py-0.5 rounded bg-slate-100 font-medium text-slate-600">
                        {post.mediaType}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">{post.postedAt}</td>
                    <td className="px-6 py-4 text-right font-medium">
                      <span className="inline-flex items-center gap-1 text-rose-600">
                        <Heart className="h-3.5 w-3.5" />
                        {formatMetric(post.likes)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-medium">
                      <span className="inline-flex items-center gap-1 text-teal-600">
                        <MessageCircle className="h-3.5 w-3.5" />
                        {formatMetric(post.comments)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right font-medium">
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <Eye className="h-3.5 w-3.5" />
                        {formatMetric(post.views)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      {post.url ? (
                        <a
                          href={post.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                        >
                          View <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-slate-300">n/a</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
