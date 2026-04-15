import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeGenesisImport } from "./normalize";
import { parseGenesisLog } from "./parser";

function readFixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../src/kiln/adapters/genesis-log/fixtures", name), "utf8");
}

test("normalization keeps event and telemetry provenance alongside run ids", () => {
  const parseResult = parseGenesisLog(readFixture("synthetic-three-zone.txt"));
  const normalized = normalizeGenesisImport({
    kilnId: "kiln_test",
    firingRunId: "run_test",
    parseResult,
  });

  assert.equal(normalized.events.length, 2);
  assert.equal(normalized.events[0]?.source, "controller_log");
  assert.equal(normalized.events[0]?.confidence, "observed");
  assert.equal(normalized.telemetry.length, 2);
  assert.equal(normalized.telemetry[0]?.kilnId, "kiln_test");
  assert.equal(normalized.telemetry[0]?.firingRunId, "run_test");
  assert.equal(normalized.telemetry[1]?.boardTemp, 61);
  assert.equal(normalized.lastDiagnosticsAt, "2026-04-11T12:00:00.000Z");
  assert.ok(normalized.evidence[0]?.detail.includes("observed fields"));
});
