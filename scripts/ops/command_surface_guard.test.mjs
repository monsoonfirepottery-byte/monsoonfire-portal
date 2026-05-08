import test from "node:test";
import assert from "node:assert/strict";

import {
  parseMakefile,
  parsePackageScripts,
  parseReadme,
  referencedOpsScripts
} from "./command_surface_guard.mjs";

test("parseMakefile extracts ops targets and phony declarations", () => {
  const parsed = parseMakefile(`
.PHONY: ops-check ops-hidden non-ops
ops-check:
\tbash scripts/ops/system_inventory.sh

ops-report:
\tbash scripts/ops/generate_ops_report.sh
`);

  assert.deepEqual(parsed.phony, ["ops-check", "ops-hidden"]);
  assert.deepEqual(parsed.targets, ["ops-check", "ops-report"]);
});

test("parsePackageScripts keeps npm ops command surfaces", () => {
  const parsed = parsePackageScripts(JSON.stringify({
    scripts: {
      "ops:one": "node ./scripts/ops/one.mjs --json",
      "studio:ops:status": "node ./scripts/studiobrain-status.mjs",
      test: "node --test"
    }
  }));

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.scripts.map((script) => script.name), ["ops:one"]);
});

test("parseReadme extracts documented make, npm, and direct script commands", () => {
  const parsed = parseReadme(`
\`\`\`bash
make ops-check
npm run ops:one
bash scripts/ops/cleanup_candidates.sh
node ./scripts/ops/proactive_issue_radar.mjs --write
\`\`\`
`);

  assert.deepEqual(parsed.makeCommands, ["ops-check"]);
  assert.deepEqual(parsed.npmCommands, ["ops:one"]);
  assert.deepEqual(parsed.directCommands, [
    "scripts/ops/cleanup_candidates.sh",
    "scripts/ops/proactive_issue_radar.mjs"
  ]);
});

test("referencedOpsScripts normalizes leading dot slash", () => {
  assert.deepEqual(referencedOpsScripts("node ./scripts/ops/check.mjs && bash scripts/ops/check.sh"), [
    "scripts/ops/check.mjs",
    "scripts/ops/check.sh"
  ]);
});
