import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ArtifactStore } from "../../connectivity/artifactStore";
import { MemoryKilnStore } from "../memoryStore";
import { importGenesisArtifact } from "./artifacts";

function readFixture(name: string): Buffer {
  return readFileSync(resolve(__dirname, "../../../src/kiln/adapters/genesis-log/fixtures", name));
}

function createArtifactStore(): ArtifactStore {
  const objects = new Map<string, Buffer>();
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

test("Genesis import preserves raw artifacts, checksum, and parser provenance", async () => {
  const store = new MemoryKilnStore();
  const artifactStore = createArtifactStore();
  const content = readFixture("synthetic-single-zone.txt");
  const result = await importGenesisArtifact({
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
  assert.equal(savedArtifact?.sha256, crypto.createHash("sha256").update(content).digest("hex"));
  assert.equal(savedArtifact?.sourcePath, "D:/imports/synthetic-single-zone.txt");
  assert.equal(savedArtifact?.artifactKind, "genesis_log");
  assert.equal(savedBytes?.toString("utf8"), content.toString("utf8"));
  assert.equal(result.importRun.diagnostics.parserKind, "genesis-log");
  assert.equal(result.firingRun.rawArtifactRefs.includes(result.artifact.id), true);
});

test("Genesis import tolerates partial files and still stores diagnostics plus raw evidence", async () => {
  const store = new MemoryKilnStore();
  const artifactStore = createArtifactStore();
  const result = await importGenesisArtifact({
    artifactStore,
    kilnStore: store,
    filename: "synthetic-partial.txt",
    content: readFixture("synthetic-partial.txt"),
    source: "manual_upload",
  });

  assert.equal(result.importRun.status, "completed");
  assert.ok(result.importRun.diagnostics.ambiguousFields.includes("event.ts"));
  assert.ok(result.importRun.diagnostics.ambiguousFields.includes("telemetry.ts"));
  assert.equal(result.firingRun.status, "firing");
  assert.equal(result.healthSnapshot.confidenceNotes.length >= 1, true);
});
