"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const normalize_1 = require("./normalize");
const parser_1 = require("./parser");
function readFixture(name) {
    return (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, "../../../../src/kiln/adapters/genesis-log/fixtures", name), "utf8");
}
(0, node_test_1.default)("normalization keeps event and telemetry provenance alongside run ids", () => {
    const parseResult = (0, parser_1.parseGenesisLog)(readFixture("synthetic-three-zone.txt"));
    const normalized = (0, normalize_1.normalizeGenesisImport)({
        kilnId: "kiln_test",
        firingRunId: "run_test",
        parseResult,
    });
    strict_1.default.equal(normalized.events.length, 2);
    strict_1.default.equal(normalized.events[0]?.source, "controller_log");
    strict_1.default.equal(normalized.events[0]?.confidence, "observed");
    strict_1.default.equal(normalized.telemetry.length, 2);
    strict_1.default.equal(normalized.telemetry[0]?.kilnId, "kiln_test");
    strict_1.default.equal(normalized.telemetry[0]?.firingRunId, "run_test");
    strict_1.default.equal(normalized.telemetry[1]?.boardTemp, 61);
    strict_1.default.equal(normalized.lastDiagnosticsAt, "2026-04-11T12:00:00.000Z");
    strict_1.default.ok(normalized.evidence[0]?.detail.includes("observed fields"));
});
