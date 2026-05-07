import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInventory,
  effectivityFromToolingReport,
  parseArgs
} from "./installed_tool_inventory.mjs";

test("parseArgs accepts tooling report path", () => {
  const options = parseArgs(["--json", "--tooling-report", "output/ops/tooling-quality/example.json"]);

  assert.equal(options.json, true);
  assert.ok(options.toolingReport.endsWith("output\\ops\\tooling-quality\\example.json") || options.toolingReport.endsWith("output/ops/tooling-quality/example.json"));
});

test("effectivityFromToolingReport maps findings to tool usefulness", () => {
  const effectivity = effectivityFromToolingReport({
    schema: "studiobrain-ops-tooling-quality-report.v1",
    generatedAt: "2026-05-07T08:00:00.000Z",
    status: "fail",
    sections: [
      { id: "shell-lf", status: "fail", findings: [{ code: "CRLF" }, { code: "CRLF" }] },
      { id: "shellcheck", status: "warn", findings: [{ code: "SC1017" }] },
      { id: "sqlfluff", status: "pass", findings: [] },
      { id: "actionlint", status: "warn", findings: [{ code: "expression" }] },
      { id: "compose-config", status: "warn", findings: [{ code: "compose_config_failed" }] }
    ]
  });

  assert.equal(effectivity.node.actionableFindings, 2);
  assert.equal(effectivity.node.promotionState, "candidate");
  assert.equal(effectivity.shellcheck.actionableFindings, 1);
  assert.equal(effectivity.sqlfluff.promotionState, "report_only");
  assert.equal(effectivity.actionlint.actionableFindings, 1);
  assert.equal(effectivity.actionlint.promotionState, "candidate");
  assert.equal(effectivity.docker.actionableFindings, 1);
  assert.equal(effectivity.docker.promotionState, "candidate");
  assert.equal(effectivity.uv.observed, true);
  assert.equal(effectivity.uv.actionableFindings, 0);
  assert.equal(effectivity.npx.actionableFindings, 0);
});

test("buildInventory includes effectivity summary even when tooling report is missing", () => {
  const inventory = buildInventory({ toolingReport: "output/ops/tooling-quality/missing.json" });

  assert.equal(inventory.schema, "studiobrain-installed-tool-inventory.v1");
  assert.equal(inventory.effectivitySource.status, "unavailable");
  assert.equal(typeof inventory.summary.actionableFindings, "number");
  assert.ok(inventory.tools.every((tool) => tool.effectivity));
});
