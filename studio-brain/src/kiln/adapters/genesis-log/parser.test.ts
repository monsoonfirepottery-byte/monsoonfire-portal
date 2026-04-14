import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseGenesisLog } from "./parser";

function readFixture(name: string): string {
  return readFileSync(resolve(__dirname, "../../../../src/kiln/adapters/genesis-log/fixtures", name), "utf8");
}

test("parser auto-detects all synthetic Genesis fixture families", () => {
  const cases = [
    { name: "synthetic-single-zone.txt", schema: "synthetic-genesis-v1", telemetry: 2, events: 1 },
    { name: "synthetic-three-zone.txt", schema: "synthetic-genesis-v1", telemetry: 2, events: 2 },
    { name: "synthetic-partial.txt", schema: "synthetic-genesis-v1", telemetry: 0, events: 0 },
    { name: "synthetic-event-heavy.txt", schema: "synthetic-genesis-v1", telemetry: 2, events: 4 },
    { name: "synthetic-firmware-variant.txt", schema: "synthetic-genesis-variant", telemetry: 2, events: 2 },
  ] as const;

  for (const fixture of cases) {
    const parsed = parseGenesisLog(readFixture(fixture.name));
    assert.equal(parsed.detectedSchema, fixture.schema, fixture.name);
    assert.equal(parsed.telemetry.length, fixture.telemetry, fixture.name);
    assert.equal(parsed.events.length, fixture.events, fixture.name);
    assert.equal(parsed.parserDiagnostics.parserKind, "genesis-log");
    assert.match(parsed.summary, /schema=/);
  }
});

test("parser tolerates partial and malformed rows without throwing", () => {
  const parsed = parseGenesisLog([
    readFixture("synthetic-partial.txt"),
    "nonsense payload that should be ignored",
    "TELEMETRY: ts=2026-04-11T10:00:00.000Z; tempPrimary=945; setPoint=990; strayField=unknown",
  ].join("\n"));

  assert.equal(parsed.events.length, 0);
  assert.equal(parsed.telemetry.length, 1);
  assert.ok(parsed.parserDiagnostics.warnings.some((entry) => entry.includes("Ignored unrecognized line")));
  assert.ok(parsed.parserDiagnostics.ambiguousFields.includes("event.ts"));
  assert.ok(parsed.parserDiagnostics.ambiguousFields.includes("telemetry.ts"));
  assert.ok(parsed.parserDiagnostics.unmappedFields.includes("telemetry.strayfield"));
});
