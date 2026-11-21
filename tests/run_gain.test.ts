import { describe, it } from "node:test";
import assert from "node:assert";
import { RunGainAccumulator, mergeRunGains } from "../lib/metrics/run-gain.ts";

const meta = (n: string) => ({ url: `https://example.com/${n}`, handle: n, platform: "instagram" });

describe("Run gain summary", () => {
  it("counts growth on existing posts and ignores new posts in the totals", () => {
    const acc = new RunGainAccumulator();
    acc.record(meta("a"), { likes: 0, comments: 0, views: null }, { likes: 2, comments: 0, views: null });
    acc.record(meta("b"), { likes: 10, comments: 1, views: 100 }, { likes: 10, comments: 1, views: 100 });
    acc.record(meta("c"), null, { likes: 50, comments: 5, views: null });
    const r = acc.result();
    assert.strictEqual(r.likes, 2);
    assert.strictEqual(r.postsWithGain, 1);
    assert.strictEqual(r.postsUnchanged, 1);
    assert.strictEqual(r.postsNew, 1);
  });

  it("never reports a negative gain and treats null as not measured", () => {
    const acc = new RunGainAccumulator();
    acc.record(meta("a"), { likes: 20, comments: 4, views: 50 }, { likes: 18, comments: null, views: null });
    const r = acc.result();
    assert.strictEqual(r.likes, 0);
    assert.strictEqual(r.comments, 0);
    assert.strictEqual(r.views, 0);
    assert.strictEqual(r.postsUnchanged, 1);
  });

  it("treats a null baseline as 0 once a real value arrives", () => {
    const acc = new RunGainAccumulator();
    acc.record(meta("a"), { likes: 5, comments: 0, views: null }, { likes: 5, comments: 0, views: 300 });
    assert.strictEqual(acc.result().views, 300);
  });

  it("keeps only the biggest gainers, ranked", () => {
    const acc = new RunGainAccumulator();
    for (let i = 1; i <= 8; i++) {
      acc.record(meta(`p${i}`), { likes: 0, comments: 0, views: null }, { likes: i, comments: 0, views: null });
    }
    const top = acc.result().top;
    assert.strictEqual(top.length, 5);
    assert.strictEqual(top[0].handle, "p8");
    assert.strictEqual(top[4].handle, "p4");
  });

  it("merges batches", () => {
    const a = new RunGainAccumulator();
    a.record(meta("a"), { likes: 0, comments: 0, views: null }, { likes: 3, comments: 1, views: null });
    const b = new RunGainAccumulator();
    b.record(meta("b"), { likes: 0, comments: 0, views: null }, { likes: 5, comments: 0, views: null });
    const m = mergeRunGains([a.result(), b.result()]);
    assert.strictEqual(m.likes, 8);
    assert.strictEqual(m.comments, 1);
    assert.strictEqual(m.postsWithGain, 2);
    assert.strictEqual(m.top[0].handle, "b");
  });
});
