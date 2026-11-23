import { test } from "node:test";
import assert from "node:assert/strict";
import { filterByVolunteers } from "../lib/services/scraper-orchestrator.ts";
import { buildVolunteerOptions } from "../lib/services/volunteer-options.ts";

const rows = [
  { handle: "a", volunteer_id: "v1" },
  { handle: "b", volunteer_id: "v2" },
  { handle: "c", volunteer_id: null },
];

test("no selection means every row (including unlinked accounts)", () => {
  assert.equal(filterByVolunteers(rows, undefined).length, 3);
  assert.equal(filterByVolunteers(rows, []).length, 3);
});

test("a selection keeps only those volunteers' rows and never unlinked ones", () => {
  assert.deepEqual(filterByVolunteers(rows, ["v1"]).map((r) => r.handle), ["a"]);
  assert.deepEqual(filterByVolunteers(rows, ["v1", "v2"]).map((r) => r.handle), ["a", "b"]);
});

test("a selection matching nothing returns no rows", () => {
  assert.equal(filterByVolunteers(rows, ["nobody"]).length, 0);
});

test("picker options list active platforms and drop volunteers with no active account", () => {
  const options = buildVolunteerOptions(
    [
      { id: "v1", name: "Asha" },
      { id: "v2", name: "Ravi" },
    ],
    [
      { volunteer_id: "v1", platform: "instagram" },
      { volunteer_id: "v1", platform: "x" },
      { volunteer_id: null, platform: "facebook" },
    ]
  );
  assert.equal(options.length, 1);
  assert.deepEqual(options[0], { id: "v1", name: "Asha", platforms: ["instagram", "x"] });
});
