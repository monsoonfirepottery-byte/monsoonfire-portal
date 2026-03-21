import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSourceCollapseRepairPlan,
  deriveImportedMemoryId,
  selectVerificationMappings,
} from "./lib/hybrid-import-repair-utils.mjs";

test("buildSourceCollapseRepairPlan archives wrong import ids and preserves replay source metadata", () => {
  const row = {
    content: "Preference: Firestore rejects undefined values.",
    source: "codex-resumable-session",
    clientRequestId: "codex-session-prom-57ecece2e96004ad6e7f5458",
    metadata: {
      projectLane: "monsoonfire-portal",
      corpusRecordId: "fact_4a9f3873ca1da9b668b139c3",
      corpusManifestPath: "D:/monsoonfire-portal/output/memory/run/canonical-corpus/manifest.json",
    },
    status: "accepted",
    memoryType: "semantic",
    sourceConfidence: 0.84,
    importance: 0.74,
  };
  const plan = buildSourceCollapseRepairPlan({
    rows: [row],
    tenantId: "monsoonfire-main",
    repairRunId: "repair-001",
    repairedAt: "2026-03-19T23:30:00.000Z",
  });

  const wrongId = deriveImportedMemoryId({
    tenantId: "monsoonfire-main",
    source: "import",
    clientRequestId: row.clientRequestId,
    content: row.content,
  });
  const repairedId = deriveImportedMemoryId({
    tenantId: "monsoonfire-main",
    source: row.source,
    clientRequestId: row.clientRequestId,
    content: row.content,
  });

  assert.equal(plan.repairableRows, 1);
  assert.equal(plan.archiveRows[0]?.id, wrongId);
  assert.equal(plan.archiveRows[0]?.status, "archived");
  assert.equal(plan.archiveRows[0]?.source, "import");
  assert.equal(plan.replayRows[0]?.source, "codex-resumable-session");
  assert.equal(plan.replayRows[0]?.metadata.corpusRecordId, "fact_4a9f3873ca1da9b668b139c3");
  assert.equal(plan.mappings[0]?.currentImportedId, wrongId);
  assert.equal(plan.mappings[0]?.repairedId, repairedId);
  assert.equal(plan.mappings[0]?.projectLane, "monsoonfire-portal");
});

test("selectVerificationMappings returns a bounded evenly distributed sample", () => {
  const mappings = Array.from({ length: 10 }, (_, index) => ({
    currentImportedId: `wrong-${index}`,
    repairedId: `right-${index}`,
  }));

  const sample = selectVerificationMappings(mappings, 4);

  assert.equal(sample.length, 4);
  assert.deepEqual(
    sample.map((entry) => entry.currentImportedId),
    ["wrong-0", "wrong-2", "wrong-5", "wrong-7"]
  );
});
