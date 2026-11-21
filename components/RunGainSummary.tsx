import { ExternalLink, TrendingUp } from "lucide-react";
import { platformLabel } from "@/lib/platform";
import type { RunGain } from "@/lib/metrics/run-gain";

const fmt = (n: number) => n.toLocaleString("en-IN");

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white p-2.5 text-center ring-1 ring-emerald-100">
      <div className={`text-lg font-bold tabular-nums ${value > 0 ? "text-emerald-700" : "text-slate-500"}`}>
        {value > 0 ? `+${fmt(value)}` : "0"}
      </div>
      <div className="text-xs text-slate-600">{label}</div>
    </div>
  );
}

/**
 * Shown right after a run is saved: how much likes, comments and views grew on posts we were
 * already tracking. New posts are listed separately because their numbers are not "growth".
 */
export function RunGainSummary({ gain, unavailable }: { gain: RunGain; unavailable: number }) {
  const total = gain.likes + gain.comments + gain.views;
  const checked = gain.postsWithGain + gain.postsUnchanged;

  return (
    <section aria-label="What changed in this run" className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
      <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
        <TrendingUp className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        What changed in this run
      </h3>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Stat label="Likes" value={gain.likes} />
        <Stat label="Comments" value={gain.comments} />
        <Stat label="Views" value={gain.views} />
      </div>

      <p className="mt-2 text-xs text-slate-600">
        {checked === 0
          ? "No previously stored posts were updated in this run."
          : `${fmt(gain.postsWithGain)} of ${fmt(checked)} existing post${checked === 1 ? "" : "s"} gained engagement, ${fmt(gain.postsUnchanged)} unchanged.`}
        {gain.postsNew > 0 && ` ${fmt(gain.postsNew)} new post${gain.postsNew === 1 ? "" : "s"} added (not counted as gain).`}
      </p>

      {total === 0 && checked > 0 && (
        <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800 ring-1 ring-amber-200">
          Nothing grew since the last save. Instagram can take a while to update counts on very new posts, so try again later.
        </p>
      )}

      {gain.top.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-semibold text-slate-700">Biggest gains</div>
          <ul className="mt-1 divide-y divide-emerald-100 text-sm">
            {gain.top.map((p) => (
              <li key={p.url} className="flex items-center justify-between gap-3 py-1.5">
                <a
                  href={p.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 items-center gap-1 text-blue-700 hover:underline"
                >
                  <span className="truncate">@{p.handle}</span>
                  <span className="shrink-0 text-xs text-slate-500">({platformLabel(p.platform)})</span>
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
                <span className="shrink-0 text-xs font-medium tabular-nums text-emerald-700">
                  {[
                    p.likes > 0 && `+${fmt(p.likes)} likes`,
                    p.comments > 0 && `+${fmt(p.comments)} comments`,
                    p.views > 0 && `+${fmt(p.views)} views`,
                  ]
                    .filter(Boolean)
                    .join("  ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {unavailable > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          {unavailable} batch{unavailable === 1 ? " was" : "es were"} already saved earlier, so {unavailable === 1 ? "its" : "their"} gain isn&apos;t included.
          Totals are on the Dashboard.
        </p>
      )}
    </section>
  );
}
