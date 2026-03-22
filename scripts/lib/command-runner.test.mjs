import test from "node:test";
import assert from "node:assert/strict";

import {
  joinPathEntries,
  prependPathEntries,
  resolvePlatformCommand,
} from "./command-runner.mjs";

test("resolvePlatformCommand adds Windows shims for npm and npx", () => {
  assert.equal(resolvePlatformCommand("npm", { platform: "win32" }), "npm.cmd");
  assert.equal(resolvePlatformCommand("npx", { platform: "win32" }), "npx.cmd");
  assert.equal(resolvePlatformCommand("npm", { platform: "linux" }), "npm");
});

test("joinPathEntries dedupes path segments", () => {
  const joined = joinPathEntries(["C:\\Tools", "C:\\Tools"], "C:\\Windows;C:\\Tools", { platform: "win32" });
  assert.equal(joined, "C:\\Tools;C:\\Windows");
});

test("prependPathEntries keeps existing env while prepending new entries", () => {
  const env = prependPathEntries(["/opt/bin"], { PATH: "/usr/bin:/bin", HOME: "/tmp" }, { platform: "linux" });
  assert.equal(env.HOME, "/tmp");
  assert.equal(env.PATH, "/opt/bin:/usr/bin:/bin");
});
