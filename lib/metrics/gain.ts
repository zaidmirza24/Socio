/**
 * "Gain over the period" metrics.
 *
 * Snapshots store CUMULATIVE totals (a post's likes on that day). The dashboard answers
 * "how much did engagement grow in the selected period", so we compare each post's latest
 * value in the period with its value just before the period started.
 *
 * Rules:
 * - A post with no earlier snapshot is new: everything it has counts as gained (baseline 0).
 * - Gain never goes below 0 (likes can drop when people un-like).
 * - null means "not measured". A null latest value stays null (shown as n/a); a null
 *   baseline falls back to the last known earlier value, then 0.
 */

export interface SnapshotPoint {
  post_id: string;
  snapshot_date: string; // YYYY-MM-DD
  likes: number | null;
  comments: number | null;
  views: number | null;
}

export interface MetricGain {
  likes: number | null;
  comments: number | null;
  views: number | null;
}

export interface DailyPostGain extends MetricGain {
  date: string;
  postId: string;
}

type MetricKey = "likes" | "comments" | "views";
const METRICS: MetricKey[] = ["likes", "comments", "views"];

function gainBetween(latest: number | null, baseline: number | null): number | null {
  if (latest === null) return null;
  return Math.max(0, latest - (baseline ?? 0));
}

function groupByPost(points: SnapshotPoint[]): Map<string, SnapshotPoint[]> {
  const byPost = new Map<string, SnapshotPoint[]>();
  for (const p of points) {
    const list = byPost.get(p.post_id);
    if (list) list.push(p);
    else byPost.set(p.post_id, [p]);
  }
  for (const list of Array.from(byPost.values())) {
    list.sort((a, b) => (a.snapshot_date < b.snapshot_date ? -1 : a.snapshot_date > b.snapshot_date ? 1 : 0));
  }
  return byPost;
}

/**
 * Gain per post for the period starting at `since` (inclusive). `since = null` means all time
 * (baseline 0). Posts with no snapshot inside the period are omitted.
 * `points` must include the snapshots before `since` that serve as the baseline.
 */
export function computePostGains(
  points: SnapshotPoint[],
  since: string | null
): Map<string, MetricGain> {
  const result = new Map<string, MetricGain>();

  for (const [postId, list] of Array.from(groupByPost(points).entries())) {
    const inWindow = list.filter((p) => since === null || p.snapshot_date >= since);
    if (inWindow.length === 0) continue;
    const latest = inWindow[inWindow.length - 1];

    const before = since === null ? [] : list.filter((p) => p.snapshot_date < since);
    const gain: MetricGain = { likes: null, comments: null, views: null };

    for (const m of METRICS) {
      let baseline: number | null = null;
      for (let i = before.length - 1; i >= 0; i--) {
        const v = before[i][m];
        if (v !== null) {
          baseline = v;
          break;
        }
      }
      gain[m] = gainBetween(latest[m], baseline);
    }
    result.set(postId, gain);
  }

  return result;
}

/**
 * Gain per post per snapshot day, for trend charts: each day's value minus the previous
 * known value of the same post. Only days on/after `since` are returned.
 */
export function computeDailyGains(points: SnapshotPoint[], since: string | null): DailyPostGain[] {
  const out: DailyPostGain[] = [];

  for (const [postId, list] of Array.from(groupByPost(points).entries())) {
    const lastKnown: Record<MetricKey, number | null> = { likes: null, comments: null, views: null };

    for (const p of list) {
      const gain: MetricGain = { likes: null, comments: null, views: null };
      for (const m of METRICS) {
        gain[m] = gainBetween(p[m], lastKnown[m]);
        if (p[m] !== null) lastKnown[m] = p[m];
      }
      if (since === null || p.snapshot_date >= since) {
        out.push({ date: p.snapshot_date, postId, ...gain });
      }
    }
  }

  return out;
}

/** Sums values, treating null (not measured) as "adds nothing". */
export function sumGain(values: Array<number | null>): number {
  let total = 0;
  for (const v of values) if (v !== null) total += v;
  return total;
}
