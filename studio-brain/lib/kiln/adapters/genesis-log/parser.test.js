"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const parser_1 = require("./parser");
function readFixture(name) {
    return (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, "../../../../src/kiln/adapters/genesis-log/fixtures", name), "utf8");
}
(0, node_test_1.default)("parser auto-detects all synthetic Genesis fixture families", () => {
    const cases = [
        { name: "synthetic-single-zone.txt", schema: "synthetic-genesis-v1", telemetry: 2, events: 1 },
        { name: "synthetic-three-zone.txt", schema: "synthetic-genesis-v1", telemetry: 2, events: 2 },
        { name: "synthetic-partial.txt", schema: "synthetic-genesis-v1", telemetry: 0, events: 0 },
        { name: "synthetic-event-heavy.txt", schema: "synthetic-genesis-v1", telemetry: 2, events: 4 },
        { name: "synthetic-firmware-variant.txt", schema: "synthetic-genesis-variant", telemetry: 2, events: 2 },
    ];
    for (const fixture of cases) {
        const parsed = (0, parser_1.parseGenesisLog)(readFixture(fixture.name));
        strict_1.default.equal(parsed.detectedSchema, fixture.schema, fixture.name);
        strict_1.default.equal(parsed.telemetry.length, fixture.telemetry, fixture.name);
        strict_1.default.equal(parsed.events.length, fixture.events, fixture.name);
        strict_1.default.equal(parsed.parserDiagnostics.parserKind, "genesis-log");
        strict_1.default.match(parsed.summary, /schema=/);
    }
});
(0, node_test_1.default)("parser tolerates partial and malformed rows without throwing", () => {
    const parsed = (0, parser_1.parseGenesisLog)([
        readFixture("synthetic-partial.txt"),
        "nonsense payload that should be ignored",
        "TELEMETRY: ts=2026-04-11T10:00:00.000Z; tempPrimary=945; setPoint=990; strayField=unknown",
    ].join("\n"));
    strict_1.default.equal(parsed.events.length, 0);
    strict_1.default.equal(parsed.telemetry.length, 1);
    strict_1.default.ok(parsed.parserDiagnostics.warnings.some((entry) => entry.includes("Ignored unrecognized line")));
    strict_1.default.ok(parsed.parserDiagnostics.ambiguousFields.includes("event.ts"));
    strict_1.default.ok(parsed.parserDiagnostics.ambiguousFields.includes("telemetry.ts"));
    strict_1.default.ok(parsed.parserDiagnostics.unmappedFields.includes("telemetry.strayfield"));
});
