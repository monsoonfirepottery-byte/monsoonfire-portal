"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const intakeControls_1 = require("./intakeControls");
(0, node_test_1.default)("classifyIntakeRisk maps categories", () => {
    const row = (0, intakeControls_1.classifyIntakeRisk)({
        actorId: "agent-1",
        ownerUid: "owner-1",
        capabilityId: "firestore.batch.close",
        rationale: "Need exact replica disney logo piece",
        previewSummary: "commission",
        requestInput: {},
    });
    strict_1.default.equal(row.category, "ip_infringement");
    strict_1.default.equal(row.blocked, true);
    strict_1.default.equal(row.disposition, "manual_review");
});
(0, node_test_1.default)("classifyIntakeRisk defaults unknown safely", () => {
    const row = (0, intakeControls_1.classifyIntakeRisk)({
        actorId: "agent-1",
        ownerUid: "owner-1",
        capabilityId: "hubitat.devices.read",
        rationale: "check dashboard status",
        previewSummary: "ops status",
        requestInput: {},
    });
    strict_1.default.equal(row.category, "unknown");
    strict_1.default.equal(row.blocked, false);
});
(0, node_test_1.default)("override grant detection and queue builder", () => {
    const events = [
        {
            id: "1",
            at: "2026-02-13T00:00:00.000Z",
            actorType: "system",
            actorId: "studio-brain",
            action: "intake.routed_to_review",
            rationale: "blocked",
            target: "local",
            approvalState: "required",
            inputHash: "a",
            outputHash: null,
            metadata: { intakeId: "abc", category: "ip_infringement", reasonCode: "ip_infringement_detected" },
        },
        {
            id: "2",
            at: "2026-02-13T00:10:00.000Z",
            actorType: "staff",
            actorId: "staff-1",
            action: "intake.override_granted",
            rationale: "approved",
            target: "local",
            approvalState: "approved",
            inputHash: "b",
            outputHash: "c",
            metadata: { intakeId: "abc" },
        },
    ];
    strict_1.default.equal((0, intakeControls_1.hasOverrideGrant)(events, "abc"), true);
    const queue = (0, intakeControls_1.buildIntakeQueue)(events, 10);
    strict_1.default.equal(queue.length, 1);
});
(0, node_test_1.default)("override transition requires reason code policy", () => {
    strict_1.default.equal((0, intakeControls_1.isValidOverrideTransition)("override_granted", "staff_override_approved"), true);
    strict_1.default.equal((0, intakeControls_1.isValidOverrideTransition)("override_granted", "policy_blocked"), false);
    strict_1.default.equal((0, intakeControls_1.isValidOverrideTransition)("override_denied", "policy_confirmed_block"), true);
});
