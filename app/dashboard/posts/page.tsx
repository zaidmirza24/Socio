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
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Recent Monitored Posts
            </h1>
            <span className="text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200/60 px-2 py-0.5 rounded-full tabular-nums">
              {posts.length} Posts
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Posts published within {rangeText} (up to 10 per account) across monitored volunteer profiles.
          </p>
        </div>
        <div className="flex items-center">
          <DateRangeFilter value={range} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200/90 bg-white shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50/90 text-[11px] uppercase font-bold text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3.5">Volunteer</th>
                <th className="px-5 py-3.5">Caption Snippet</th>
                <th className="px-5 py-3.5">Format</th>
                <th className="px-5 py-3.5">Published Date</th>
                <th className="px-5 py-3.5 text-right">Likes</th>
                <th className="px-5 py-3.5 text-right">Comments</th>
                <th className="px-5 py-3.5 text-right">Views</th>
                <th className="px-5 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {posts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-16 text-center text-slate-400">
                    <p className="text-sm font-medium text-slate-700">No posts found in database yet.</p>
                    <p className="text-xs text-slate-400 mt-1">Trigger a scrape to populate posts from active volunteer accounts.</p>
                  </td>
                </tr>
              ) : (
                posts.map((post) => (
                  <tr key={post.id} className="hover:bg-blue-50/20 transition-colors">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/dashboard/volunteers/${post.handle}`}
                        className="font-semibold text-slate-900 hover:text-blue-600 text-xs block transition"
                      >
                        @{post.handle}
                      </Link>
                      {post.volunteerName && post.volunteerName !== post.handle && (
                        <div className="text-[11px] text-slate-400 truncate max-w-[160px]">{post.volunteerName}</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-700 max-w-xs truncate" title={post.caption || ""}>
                      {post.caption || <span className="text-slate-400 italic">No caption</span>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-100 font-semibold uppercase text-slate-600">
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
                          <span>Open</span>
                          <ExternalLink className="h-3 w-3" />
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
