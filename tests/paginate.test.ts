import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllRows, chunk } from "../lib/supabase/paginate.ts";

/** Fake PostgREST range query over `total` rows with the hosted 1000-row cap. */
function fakeTable(total: number) {
  const calls: [number, number][] = [];
  const build = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, total - 1, from + 999);
    const data = from > end ? [] : Array.from({ length: end - from + 1 }, (_, i) => ({ id: from + i }));
    return { data, error: null };
  };
  return { build, calls };
}

test("fetchAllRows returns every row past the 1000-row cap (e.g. 1800 accounts)", async () => {
  const { build, calls } = fakeTable(1800);
  const rows = await fetchAllRows<{ id: number }>(build);
  assert.equal(rows.length, 1800);
  assert.equal(new Set(rows.map((r) => r.id)).size, 1800);
  assert.deepEqual(calls, [
    [0, 999],
    [1000, 1999],
  ]);
});

test("fetchAllRows makes one extra empty call when the total is an exact multiple of the page", async () => {
  const { build, calls } = fakeTable(2000);
  const rows = await fetchAllRows<{ id: number }>(build);
  assert.equal(rows.length, 2000);
  assert.equal(calls.length, 3);
});

test("fetchAllRows surfaces query errors instead of returning a partial list", async () => {
  await assert.rejects(
    fetchAllRows(async () => ({ data: null, error: { message: "boom" } })),
    /boom/
  );
});

test("chunk keeps .in() filters small", () => {
  const ids = Array.from({ length: 601 }, (_, i) => `id-${i}`);
  const parts = chunk(ids, 200);
  assert.deepEqual(parts.map((p) => p.length), [200, 200, 200, 1]);
});
