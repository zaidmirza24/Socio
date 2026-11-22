import { test } from "node:test";
import assert from "node:assert/strict";
import { extractHandleAndPlatform } from "../lib/utils/account-handles.ts";

test("strips @ and lower-cases a raw handle, keeping the default platform", () => {
  assert.deepEqual(extractHandleAndPlatform("  @Some_User/ ", "x"), { handle: "some_user", platform: "x" });
});

test("detects platform and handle from profile URLs", () => {
  assert.deepEqual(extractHandleAndPlatform("https://www.instagram.com/Foo/?hl=en"), { handle: "foo", platform: "instagram" });
  assert.deepEqual(extractHandleAndPlatform("https://twitter.com/Bar#x", "instagram"), { handle: "bar", platform: "x" });
  assert.deepEqual(extractHandleAndPlatform("https://facebook.com/profile.php?id=12345"), { handle: "12345", platform: "facebook" });
});
