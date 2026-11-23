import Link from "next/link";
import { Search } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPages } from "@/lib/supabase/metrics-data";
import { formatMetric, formatDisplayDate } from "@/lib/utils";
import { isCurrentUserAdmin } from "@/lib/supabase/require-admin";
import { DeleteVolunteerButton } from "@/components/volunteers/DeleteVolunteerButton";
import { PlatformFilter } from "@/components/analytics/PlatformFilter";
import { PlatformBadge } from "@/components/ui/PlatformBadge";
import { ErrorState } from "@/components/ui/ErrorState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { parsePlatformFilter } from "@/lib/platform";
import { accountProfileHref } from "@/lib/utils/volunteer-links";
import type { PlatformType, VolunteerTotals } from "@/types/database";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SortKey = "likes" | "comments" | "shares" | "views" | "posts" | "recent" | "name";
const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: "likes", label: "Most likes" },
  { id: "comments", label: "Most comments" },
  { id: "views", label: "Most views" },
  { id: "shares", label: "Most shares" },
  { id: "posts", label: "Most posts" },
  { id: "recent", label: "Latest post" },
  { id: "name", label: "Name (A–Z)" },
];

interface AccountLink {
  volunteer_id: string;
  platform: PlatformType;
  handle: string;
}

interface Props {
  searchParams: Promise<{ q?: string; sort?: string; page?: string; platform?: string }>;
}

/** null = not reported; sorts below any real number. */
interface VolunteerPlatformTotals {
  volunteer_id: string;
  name: string;
  platform: string;
  accounts_count: number;
  posts_count: number;
  total_likes: number | null;
  total_comments: number | null;
  total_shares: number | null;
  total_views: number | null;
  last_posted_at: string | null;
}

function num(v: number | null): number {
  return v ?? -1;
}

export default async function VolunteersPage({ searchParams }: Props) {
  const sp = await searchParams;
  const platform = parsePlatformFilter(sp?.platform);
  const search = (sp?.q ?? "").trim().slice(0, 80);
  const sort: SortKey = SORTS.some((s) => s.id === sp?.sort) ? (sp?.sort as SortKey) : "likes";
  const pageNum = Math.max(parseInt(sp?.page ?? "1", 10) || 1, 1);

  const admin = createAdminClient();
  const isAdmin = await isCurrentUserAdmin();
  let loadError: string | null = null;
  let all: VolunteerTotals[] = [];
  const links = new Map<string, AccountLink[]>();

  try {
    const [totals, accounts] = await Promise.all([
      // With a platform filter, totals must only count that platform's posts (volunteer_totals
      // sums every platform), so read the per-platform view and shape it like VolunteerTotals.
      platform === "all"
        ? fetchAllPages<VolunteerTotals>(async (from, to) => {
            const res = await admin.from("volunteer_totals").select("*").order("volunteer_id").range(from, to);
            return { data: res.data as VolunteerTotals[] | null, error: res.error };
          })
        : fetchAllPages<VolunteerPlatformTotals>(async (from, to) => {
            const res = await admin
              .from("volunteer_platform_totals")
              .select("*")
              .eq("platform", platform)
              .order("volunteer_id")
              .range(from, to);
            return { data: res.data as VolunteerPlatformTotals[] | null, error: res.error };
          }).then((rows) =>
            rows.map(
              (r): VolunteerTotals => ({
                volunteer_id: r.volunteer_id,
                name: r.name,
                accounts_count: r.accounts_count,
                instagram_accounts: r.platform === "instagram" ? r.accounts_count : 0,
                facebook_accounts: r.platform === "facebook" ? r.accounts_count : 0,
                x_accounts: r.platform === "x" ? r.accounts_count : 0,
                posts_count: r.posts_count,
                total_likes: r.total_likes,
                total_comments: r.total_comments,
                total_shares: r.total_shares,
                total_views: r.total_views,
                last_posted_at: r.last_posted_at,
              })
            )
          ),
      fetchAllPages<AccountLink>(async (from, to) => {
        const res = await admin
          .from("accounts")
          .select("volunteer_id, platform, handle")
          .not("volunteer_id", "is", null)
          .order("volunteer_id")
          .range(from, to);
        return { data: res.data as AccountLink[] | null, error: res.error };
      }),
    ]);
    all = totals;
    for (const a of accounts) {
      const list = links.get(a.volunteer_id) ?? [];
      list.push(a);
      links.set(a.volunteer_id, list);
    }
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load volunteers";
  }

  const needle = search.toLowerCase();
  const filtered = all.filter((v) => {
    if (platform === "instagram" && v.instagram_accounts === 0) return false;
    if (platform === "facebook" && v.facebook_accounts === 0) return false;
    if (platform === "x" && v.x_accounts === 0) return false;
    if (!needle) return true;
    if (v.name.toLowerCase().includes(needle)) return true;
    return (links.get(v.volunteer_id) ?? []).some((a) => a.handle.toLowerCase().includes(needle));
  });

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case "name":
        return a.name.localeCompare(b.name);
      case "posts":
        return b.posts_count - a.posts_count;
      case "comments":
        return num(b.total_comments) - num(a.total_comments);
      case "views":
        return num(b.total_views) - num(a.total_views);
      case "shares":
        return num(b.total_shares) - num(a.total_shares);
      case "recent":
        return (b.last_posted_at ?? "").localeCompare(a.last_posted_at ?? "");
      default:
        return num(b.total_likes) - num(a.total_likes);
    }
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(pageNum, totalPages);
  const rows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const buildUrl = (targetPage: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (sort !== "likes") params.set("sort", sort);
    if (platform !== "all") params.set("platform", platform);
    if (targetPage > 1) params.set("page", String(targetPage));
    const qs = params.toString();
    return `/dashboard/volunteers${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Volunteers"
        badge={sorted.length.toLocaleString("en-IN")}
        description="One row per volunteer, combining their Instagram, Facebook and X accounts. Totals are lifetime counts on stored posts; to see growth in a date range, use the Dashboard. “n/a” means the platform does not report that number."
      >
        <form method="get" action="/dashboard/volunteers" className="flex flex-wrap items-center gap-2.5">
          {platform !== "all" && <input type="hidden" name="platform" value={platform} />}
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Search name or handle..."
              aria-label="Search volunteers"
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <select
            name="sort"
            aria-label="Sort by"
            defaultValue={sort}
            className="rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-3.5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
          >
            Search
          </button>
          <PlatformFilter value={platform} />
        </form>
      </PageHeader>

      {loadError && (
        <ErrorState
          title="Couldn't load volunteers"
          message="The list can't be shown right now. Reload the page to try again."
          detail={loadError}
        >
          <a href="" className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Reload page
          </a>
        </ErrorState>
      )}

      {!loadError && sorted.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          {all.length === 0 ? (
            <>
              No volunteers yet. Add some on the{" "}
              <Link href="/dashboard/accounts" className="text-blue-600 underline">
                Accounts
              </Link>{" "}
              page.
            </>
          ) : (
            "No volunteers match these filters."
          )}
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3">Volunteer</th>
                  <th className="px-4 py-3">Accounts</th>
                  <th className="px-4 py-3 text-right">Posts</th>
                  <th className="px-4 py-3 text-right">Likes</th>
                  <th className="px-4 py-3 text-right">Comments</th>
                  <th className="px-4 py-3 text-right">Shares</th>
                  <th className="px-4 py-3 text-right">Views</th>
                  <th className="px-4 py-3">Last post</th>
                  {isAdmin && <th className="px-4 py-3"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((v) => (
                  <tr key={v.volunteer_id} className="hover:bg-slate-50/60">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      <Link
                        href={`/dashboard/volunteers/v/${v.volunteer_id}?from=volunteers`}
                        className="hover:text-blue-600 hover:underline"
                      >
                        {v.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        {(links.get(v.volunteer_id) ?? []).map((a) => (
                          <Link
                            key={`${a.platform}:${a.handle}`}
                            href={accountProfileHref(a.handle, a.platform, "volunteers")}
                            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-700 hover:border-blue-300 hover:text-blue-700"
                          >
                            <PlatformBadge platform={a.platform} compact />@{a.handle}
                          </Link>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{v.posts_count}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMetric(v.total_likes)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMetric(v.total_comments)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMetric(v.total_shares)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatMetric(v.total_views)}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {v.last_posted_at ? formatDisplayDate(v.last_posted_at) : "n/a"}
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-3 text-right">
                        <DeleteVolunteerButton volunteerId={v.volunteer_id} name={v.name} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination page={page} pageSize={PAGE_SIZE} total={sorted.length} hrefFor={buildUrl} />
        </div>
      )}
    </div>
  );
}
