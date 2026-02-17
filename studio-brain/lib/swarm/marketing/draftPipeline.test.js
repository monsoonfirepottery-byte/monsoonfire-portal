"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const draftPipeline_1 = require("./draftPipeline");
const snapshot = {
    schemaVersion: "v3.0",
    snapshotDate: "2026-02-13",
    generatedAt: "2026-02-13T00:00:00.000Z",
    cloudSync: { firestoreReadAt: "2026-02-13T00:00:00.000Z", stripeReadAt: null },
    counts: { batchesActive: 12, batchesClosed: 21, reservationsOpen: 14, firingsScheduled: 3, reportsOpen: 2 },
    ops: { blockedTickets: 1, agentRequestsPending: 5, highSeverityReports: 0 },
    finance: { pendingOrders: 1, unsettledPayments: 0 },
    sourceHashes: { firestore: "h1", stripe: null },
};
(0, node_test_1.default)("buildMarketingDrafts produces deterministic metadata", () => {
    const drafts = (0, draftPipeline_1.buildMarketingDrafts)(snapshot);
    strict_1.default.equal(drafts.length, 2);
    strict_1.default.equal(drafts[0].draftId, "mk-2026-02-13-ig");
    strict_1.default.equal(drafts[0].templateVersion, "marketing-v1");
    strict_1.default.equal(drafts[0].status, "draft");
});
(0, node_test_1.default)("hasRecentMarketingDraft enforces cooldown", () => {
    const yes = (0, draftPipeline_1.hasRecentMarketingDraft)([
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
    ], "2026-02-13", 360, new Date("2026-02-13T01:00:00.000Z"));
    strict_1.default.equal(yes, true);
});
(0, node_test_1.default)("canTransitionDraftStatus gates approval path", () => {
    strict_1.default.equal((0, draftPipeline_1.canTransitionDraftStatus)("draft", "approved_for_publish"), false);
    strict_1.default.equal((0, draftPipeline_1.canTransitionDraftStatus)("draft", "needs_review"), true);
    strict_1.default.equal((0, draftPipeline_1.canTransitionDraftStatus)("needs_review", "approved_for_publish"), true);
});
