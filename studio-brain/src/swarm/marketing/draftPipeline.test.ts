import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketingDrafts, canTransitionDraftStatus, hasRecentMarketingDraft } from "./draftPipeline";
import type { StudioStateSnapshot } from "../../stores/interfaces";

const snapshot: StudioStateSnapshot = {
  schemaVersion: "v3.0",
  snapshotDate: "2026-02-13",
  generatedAt: "2026-02-13T00:00:00.000Z",
  cloudSync: { firestoreReadAt: "2026-02-13T00:00:00.000Z", stripeReadAt: null },
  counts: { batchesActive: 12, batchesClosed: 21, reservationsOpen: 14, firingsScheduled: 3, reportsOpen: 2 },
  ops: { blockedTickets: 1, agentRequestsPending: 5, highSeverityReports: 0 },
  finance: { pendingOrders: 1, unsettledPayments: 0 },
  sourceHashes: { firestore: "h1", stripe: null },
};

test("buildMarketingDrafts produces deterministic metadata", () => {
  const drafts = buildMarketingDrafts(snapshot);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].draftId, "mk-2026-02-13-ig");
  assert.equal(drafts[0].templateVersion, "marketing-v1");
  assert.equal(drafts[0].status, "draft");
});

test("hasRecentMarketingDraft enforces cooldown", () => {
  const yes = hasRecentMarketingDraft(
    [
      {
        id: "1",
        at: "2026-02-13T00:00:00.000Z",
        actorType: "system",
        actorId: "studio-brain",
        action: "studio_marketing.draft_created",
        rationale: "generated",
        target: "local",
        approvalState: "exempt",
        inputHash: "a",
        outputHash: "b",
        metadata: { sourceSnapshotDate: "2026-02-13" },
      },
    ],
    "2026-02-13",
    360,
    new Date("2026-02-13T01:00:00.000Z")
  );
  assert.equal(yes, true);
});

test("canTransitionDraftStatus gates approval path", () => {
  assert.equal(canTransitionDraftStatus("draft", "approved_for_publish"), false);
  assert.equal(canTransitionDraftStatus("draft", "needs_review"), true);
  assert.equal(canTransitionDraftStatus("needs_review", "approved_for_publish"), true);
});
