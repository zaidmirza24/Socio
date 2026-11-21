/**
 * "What did this collection run change?" summary.
 *
 * Compares each post's new numbers with the most recent snapshot stored before this run wrote its
 * own. Rules match lib/metrics/gain.ts:
 * - null means "not measured": it never counts as a gain and never as a loss.
 * - Gain never goes below 0 (likes can drop when people un-like).
 * - A post with no earlier snapshot is NEW. It is counted separately, not as gain, so a refresh
 *   total only reflects growth on posts we were already tracking.
 */

export interface EngagementValues {
  likes: number | null;
  comments: number | null;
  views: number | null;
}

export interface PostGainSample {
  url: string;
  handle: string;
  platform: string;
  likes: number;
  comments: number;
  views: number;
}

export interface RunGain {
  likes: number;
  comments: number;
  views: number;
  /** Existing posts whose likes, comments or views went up. */
  postsWithGain: number;
  /** Existing posts checked that did not change. */
  postsUnchanged: number;
  /** Posts seen for the first time in this run (not counted in the totals above). */
  postsNew: number;
  /** Biggest gainers first (likes + comments + views). */
  top: PostGainSample[];
}

const TOP_LIMIT = 5;

function diff(next: number | null, prev: number | null): number {
  if (next === null) return 0;
  return Math.max(0, next - (prev ?? 0));
}

const weight = (s: { likes: number; comments: number; views: number }) => s.likes + s.comments + s.views;

export function emptyRunGain(): RunGain {
  return { likes: 0, comments: 0, views: 0, postsWithGain: 0, postsUnchanged: 0, postsNew: 0, top: [] };
}

/** Accumulates per-post changes while a run is being saved. Single-threaded use only. */
export class RunGainAccumulator {
  private gain: RunGain = emptyRunGain();

  /** `previous` is null when the post had no snapshot before this run. */
  record(
    post: { url: string; handle: string; platform: string },
    previous: EngagementValues | null,
    next: EngagementValues
  ): void {
    if (previous === null) {
      this.gain.postsNew++;
      return;
    }
    const sample: PostGainSample = {
      ...post,
      likes: diff(next.likes, previous.likes),
      comments: diff(next.comments, previous.comments),
      views: diff(next.views, previous.views),
    };
    if (weight(sample) === 0) {
      this.gain.postsUnchanged++;
      return;
    }
    this.gain.likes += sample.likes;
    this.gain.comments += sample.comments;
    this.gain.views += sample.views;
    this.gain.postsWithGain++;
    this.gain.top.push(sample);
    this.gain.top.sort((a, b) => weight(b) - weight(a));
    if (this.gain.top.length > TOP_LIMIT) this.gain.top.length = TOP_LIMIT;
  }

  result(): RunGain {
    return { ...this.gain, top: [...this.gain.top] };
  }
}

/** Adds several run summaries together (e.g. a refresh split into batches, or several platforms). */
export function mergeRunGains(parts: RunGain[]): RunGain {
  const out = emptyRunGain();
  for (const p of parts) {
    out.likes += p.likes;
    out.comments += p.comments;
    out.views += p.views;
    out.postsWithGain += p.postsWithGain;
    out.postsUnchanged += p.postsUnchanged;
    out.postsNew += p.postsNew;
    out.top.push(...p.top);
  }
  out.top.sort((a, b) => weight(b) - weight(a));
  out.top.length = Math.min(out.top.length, TOP_LIMIT);
  return out;
}
