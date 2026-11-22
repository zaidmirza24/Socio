import { test } from "node:test";
import assert from "node:assert/strict";
import { accountProfileHref, isVolunteerId, volunteerProfileHref } from "../lib/utils/volunteer-links.ts";

const ID = "3f2b8c1e-5d4a-4b7e-9c10-1a2b3c4d5e6f";

test("a known volunteer links to the combined volunteer page", () => {
  assert.equal(
    volunteerProfileHref({ volunteerId: ID, handle: "foo", platform: "x", from: "matrix" }),
    `/dashboard/volunteers/v/${ID}?from=matrix`
  );
  assert.equal(volunteerProfileHref({ volunteerId: ID, handle: "foo", platform: "x" }), `/dashboard/volunteers/v/${ID}`);
});

test("without a volunteer id it falls back to the single-account page", () => {
  assert.equal(
    volunteerProfileHref({ volunteerId: null, handle: "foo", platform: "facebook" }),
    "/dashboard/volunteers/foo?platform=facebook"
  );
  // A malformed id must never be put into a path.
  assert.equal(
    volunteerProfileHref({ volunteerId: "../etc", handle: "foo", platform: "x" }),
    "/dashboard/volunteers/foo?platform=x"
  );
});

test("account links encode the handle and keep the source", () => {
  assert.equal(
    accountProfileHref("a b", "instagram", "volunteers"),
    "/dashboard/volunteers/a%20b?platform=instagram&from=volunteers"
  );
});

test("isVolunteerId only accepts uuids", () => {
  assert.equal(isVolunteerId(ID), true);
  assert.equal(isVolunteerId("acct:123"), false);
});
