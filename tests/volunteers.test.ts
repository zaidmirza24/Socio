import { test } from "node:test";
import assert from "node:assert/strict";
import { assignVolunteers } from "../lib/services/volunteers.ts";

test("same name on three platforms becomes one volunteer", () => {
  const { assignments, toCreate } = assignVolunteers(
    [
      { platform: "instagram", handle: "asha_ig", volunteer_name: "Asha Rao" },
      { platform: "facebook", handle: "asha.fb", volunteer_name: "asha rao" },
      { platform: "x", handle: "asha_x", volunteer_name: "Asha Rao " },
    ],
    [],
    []
  );
  assert.equal(toCreate.length, 1);
  assert.equal(new Set(assignments.map((a) => a.volunteerRef)).size, 1);
});

test("two people sharing a name on the same platform stay separate volunteers", () => {
  const { assignments, toCreate } = assignVolunteers(
    [
      { platform: "instagram", handle: "rahul1", volunteer_name: "Rahul Sharma" },
      { platform: "instagram", handle: "rahul2", volunteer_name: "Rahul Sharma" },
    ],
    [],
    []
  );
  assert.equal(toCreate.length, 2);
  assert.notEqual(assignments[0].volunteerRef, assignments[1].volunteerRef);
});

test("re-importing an existing account keeps its volunteer (idempotent)", () => {
  const { assignments, toCreate } = assignVolunteers(
    [{ platform: "instagram", handle: "asha_ig", volunteer_name: "Asha Rao" }],
    [{ id: "v1", name: "Asha Rao", platforms: new Set(["instagram"]) }],
    [{ platform: "instagram", handle: "asha_ig", volunteer_id: "v1" }]
  );
  assert.equal(toCreate.length, 0);
  assert.equal(assignments[0].volunteerRef, "v1");
});

test("adding a new platform for an existing volunteer joins them", () => {
  const { assignments, toCreate } = assignVolunteers(
    [{ platform: "x", handle: "asha_x", volunteer_name: "Asha Rao" }],
    [{ id: "v1", name: "Asha Rao", platforms: new Set(["instagram"]) }],
    [{ platform: "instagram", handle: "asha_ig", volunteer_id: "v1" }]
  );
  assert.equal(toCreate.length, 0);
  assert.equal(assignments[0].volunteerRef, "v1");
});
