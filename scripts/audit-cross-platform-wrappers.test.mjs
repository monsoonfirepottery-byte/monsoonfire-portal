import test from "node:test";
import assert from "node:assert/strict";

import { scanSourceText } from "./audit-cross-platform-wrappers.mjs";

test("scanSourceText detects unsafe wrapper patterns", () => {
  const findings = scanSourceText('spawnSync("npx", ["firebase-tools"]); const env = { PATH: `${foo}:${bar}` };');
  assert.equal(findings.length, 2);
  assert.equal(findings[0].id, "bare-npx-spawn");
});

test("scanSourceText ignores safe helper-driven patterns", () => {
  const findings = scanSourceText('const env = prependPathEntries(["/opt/bin"], process.env);');
  assert.equal(findings.length, 0);
});
