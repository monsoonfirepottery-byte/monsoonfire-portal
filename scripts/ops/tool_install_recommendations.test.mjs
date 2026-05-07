import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReport,
  parseArgs,
  recommendationFor
} from "./tool_install_recommendations.mjs";

test("parseArgs accepts inventory and write flags", () => {
  const options = parseArgs(["--json", "--write", "--inventory", "output/ops/example.json"]);

  assert.equal(options.json, true);
  assert.equal(options.write, true);
  assert.ok(options.inventory.endsWith("output\\ops\\example.json") || options.inventory.endsWith("output/ops/example.json"));
});

test("recommendationFor turns coverage gaps into non-destructive install guidance", () => {
  const recommendation = recommendationFor({
    name: "shellcheck",
    status: "missing_optional",
    effectivity: {
      actionableFindings: 0,
      coverageGaps: 1
    }
  });

  assert.equal(recommendation.tool, "shellcheck");
  assert.equal(recommendation.priority, "P1");
  assert.equal(recommendation.acquisitionClass, "ephemeral-runner");
  assert.equal(recommendation.approvalRequired, false);
  assert.equal(recommendation.destructive, false);
  assert.match(recommendation.validationCommand, /shellcheck/);
});

test("buildReport ranks coverage gaps before unmeasured missing tools", () => {
  const report = buildReport({
    inventory: "output/ops/effectivity/installed-tool-inventory-latest.json",
    inventoryObject: {
      schema: "studiobrain-installed-tool-inventory.v1",
      generatedAt: "2026-05-07T14:00:00.000Z",
      status: "warn",
      tools: [
        { name: "shfmt", status: "missing_optional", effectivity: { actionableFindings: 0, coverageGaps: 0 } },
        { name: "docker", status: "missing_optional", effectivity: { actionableFindings: 0, coverageGaps: 1 } },
        { name: "shellcheck", status: "missing_optional", effectivity: { actionableFindings: 0, coverageGaps: 1 } }
      ]
    }
  });

  assert.equal(report.schema, "studiobrain-ops-tool-install-recommendations.v1");
  assert.equal(report.summary.recommendations, 3);
  assert.equal(report.summary.coverageGaps, 2);
  assert.equal(report.summary.installNowCandidates, 1);
  assert.deepEqual(report.recommendations.map((item) => item.tool), ["shellcheck", "docker", "shfmt"]);
});
