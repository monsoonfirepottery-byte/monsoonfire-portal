import assert from "node:assert/strict";
import test from "node:test";

import { buildDbProbeReport } from "./lib/wiki-postgres-utils.mjs";

test("wiki db probe dry-run statically validates query names, targets, and index assumptions", () => {
  const report = buildDbProbeReport();

  assert.equal(report.schema, "wiki-db-probe.v1");
  assert.equal(report.status, "pass");
  assert.equal(report.staticVerification.status, "pass");
  assert.equal(report.staticVerification.findings.length, 0);

  const names = new Set(report.queries.map((query) => query.name));
  assert.equal(names.size, report.queries.length);
  for (const query of report.queries) {
    assert.ok(query.targetMs > 0, `${query.name} should have a target latency`);
    assert.ok(query.parameters.length > 0, `${query.name} should declare probe parameters`);
    assert.ok(query.expectedIndexAssumptions.length > 0, `${query.name} should declare index assumptions`);
    assert.match(query.mutationSafety, /read-only|dry-run/i);
  }
});
