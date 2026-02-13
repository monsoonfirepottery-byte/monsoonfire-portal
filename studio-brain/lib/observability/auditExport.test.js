"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const auditExport_1 = require("./auditExport");
const sampleRows = [
    {
        id: "a1",
        at: "2026-02-13T00:00:00.000Z",
        actorType: "staff",
        actorId: "staff-1",
        action: "capability.firestore.batch.close.proposal_created",
        rationale: "rationale",
        target: "local",
        approvalState: "approved",
        inputHash: "in-1",
        outputHash: null,
        metadata: { proposalId: "p1" },
    },
];
(0, node_test_1.default)("audit export bundle verifies payload integrity", () => {
    const bundle = (0, auditExport_1.buildAuditExportBundle)(sampleRows, { generatedAt: "2026-02-13T01:00:00.000Z" });
    const verification = (0, auditExport_1.verifyAuditExportBundle)(bundle);
    strict_1.default.equal(verification.ok, true);
});
(0, node_test_1.default)("audit export bundle verifies signature integrity", () => {
    const bundle = (0, auditExport_1.buildAuditExportBundle)(sampleRows, { generatedAt: "2026-02-13T01:00:00.000Z", signingKey: "secret" });
    const verification = (0, auditExport_1.verifyAuditExportBundle)(bundle, "secret");
    strict_1.default.equal(verification.ok, true);
    const bad = (0, auditExport_1.verifyAuditExportBundle)(bundle, "wrong");
    strict_1.default.equal(bad.ok, false);
});
