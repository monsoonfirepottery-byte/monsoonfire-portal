"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const memoryStore_1 = require("../memoryStore");
const artifacts_1 = require("./artifacts");
function readFixture(name) {
    return (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(__dirname, "../../../src/kiln/adapters/genesis-log/fixtures", name));
}
function createArtifactStore() {
    const objects = new Map();
    return {
        async put(key, data) {
            objects.set(key, Buffer.from(data));
        },
        async get(key) {
            return objects.get(key) ?? null;
        },
        async list(prefix = "") {
            return [...objects.keys()].filter((entry) => entry.startsWith(prefix));
        },
        async healthcheck() {
            return { ok: true, latencyMs: 0 };
        },
    };
}
(0, node_test_1.default)("Genesis import preserves raw artifacts, checksum, and parser provenance", async () => {
    const store = new memoryStore_1.MemoryKilnStore();
    const artifactStore = createArtifactStore();
    const content = readFixture("synthetic-single-zone.txt");
    const result = await (0, artifacts_1.importGenesisArtifact)({
        artifactStore,
        kilnStore: store,
        filename: "synthetic-single-zone.txt",
        content,
        observedAt: "2026-04-14T12:00:00.000Z",
        sourceLabel: "manual-upload",
        sourcePath: "D:/imports/synthetic-single-zone.txt",
        source: "manual_upload",
    });
    const savedArtifact = await store.getArtifactRecord(result.artifact.id);
    const savedBytes = await artifactStore.get(result.artifact.storageKey);
    strict_1.default.equal(savedArtifact?.sha256, node_crypto_1.default.createHash("sha256").update(content).digest("hex"));
    strict_1.default.equal(savedArtifact?.sourcePath, "D:/imports/synthetic-single-zone.txt");
    strict_1.default.equal(savedArtifact?.artifactKind, "genesis_log");
    strict_1.default.equal(savedBytes?.toString("utf8"), content.toString("utf8"));
    strict_1.default.equal(result.importRun.diagnostics.parserKind, "genesis-log");
    strict_1.default.equal(result.firingRun.rawArtifactRefs.includes(result.artifact.id), true);
});
(0, node_test_1.default)("Genesis import tolerates partial files and still stores diagnostics plus raw evidence", async () => {
    const store = new memoryStore_1.MemoryKilnStore();
    const artifactStore = createArtifactStore();
    const result = await (0, artifacts_1.importGenesisArtifact)({
        artifactStore,
        kilnStore: store,
        filename: "synthetic-partial.txt",
        content: readFixture("synthetic-partial.txt"),
        source: "manual_upload",
    });
    strict_1.default.equal(result.importRun.status, "completed");
    strict_1.default.ok(result.importRun.diagnostics.ambiguousFields.includes("event.ts"));
    strict_1.default.ok(result.importRun.diagnostics.ambiguousFields.includes("telemetry.ts"));
    strict_1.default.equal(result.firingRun.status, "firing");
    strict_1.default.equal(result.healthSnapshot.confidenceNotes.length >= 1, true);
});
