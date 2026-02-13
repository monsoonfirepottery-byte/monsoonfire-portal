"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const actorResolution_1 = require("./actorResolution");
(0, node_test_1.default)("resolveCapabilityActor allows valid agent delegation", () => {
    const result = (0, actorResolution_1.resolveCapabilityActor)({
        actorType: "agent",
        actorUid: "agent-1",
        ownerUid: "owner-1",
        capabilityId: "firestore.batch.close",
        principalUid: "staff-uid",
        delegation: {
            delegationId: "del-1",
            agentUid: "agent-1",
            ownerUid: "owner-1",
            scopes: ["capability:firestore.batch.close:execute"],
            expiresAt: "2026-02-14T00:00:00.000Z",
        },
        now: new Date("2026-02-13T00:00:00.000Z"),
    });
    strict_1.default.equal(result.allowed, true);
    strict_1.default.equal(result.reasonCode, "ALLOWED");
    strict_1.default.equal(result.actor?.actorType, "agent");
});
(0, node_test_1.default)("resolveCapabilityActor denies missing delegation", () => {
    const result = (0, actorResolution_1.resolveCapabilityActor)({
        actorType: "agent",
        actorUid: "agent-1",
        ownerUid: "owner-1",
        capabilityId: "firestore.batch.close",
        principalUid: "staff-uid",
    });
    strict_1.default.equal(result.allowed, false);
    strict_1.default.equal(result.reasonCode, "DELEGATION_MISSING");
});
(0, node_test_1.default)("resolveCapabilityActor denies expired delegation", () => {
    const result = (0, actorResolution_1.resolveCapabilityActor)({
        actorType: "agent",
        actorUid: "agent-1",
        ownerUid: "owner-1",
        capabilityId: "firestore.batch.close",
        principalUid: "staff-uid",
        delegation: {
            delegationId: "del-1",
            agentUid: "agent-1",
            ownerUid: "owner-1",
            scopes: ["capability:firestore.batch.close:execute"],
            expiresAt: "2026-02-12T00:00:00.000Z",
        },
        now: new Date("2026-02-13T00:00:00.000Z"),
    });
    strict_1.default.equal(result.allowed, false);
    strict_1.default.equal(result.reasonCode, "DELEGATION_EXPIRED");
});
(0, node_test_1.default)("resolveCapabilityActor denies revoked delegation", () => {
    const result = (0, actorResolution_1.resolveCapabilityActor)({
        actorType: "agent",
        actorUid: "agent-1",
        ownerUid: "owner-1",
        capabilityId: "firestore.batch.close",
        principalUid: "staff-uid",
        delegation: {
            delegationId: "del-1",
            agentUid: "agent-1",
            ownerUid: "owner-1",
            scopes: ["capability:firestore.batch.close:execute"],
            revokedAt: "2026-02-12T00:00:00.000Z",
            expiresAt: "2026-02-14T00:00:00.000Z",
        },
    });
    strict_1.default.equal(result.allowed, false);
    strict_1.default.equal(result.reasonCode, "DELEGATION_REVOKED");
});
(0, node_test_1.default)("resolveCapabilityActor denies wrong owner", () => {
    const result = (0, actorResolution_1.resolveCapabilityActor)({
        actorType: "agent",
        actorUid: "agent-1",
        ownerUid: "owner-2",
        capabilityId: "firestore.batch.close",
        principalUid: "staff-uid",
        delegation: {
            delegationId: "del-1",
            agentUid: "agent-1",
            ownerUid: "owner-1",
            scopes: ["capability:firestore.batch.close:execute"],
            expiresAt: "2026-02-14T00:00:00.000Z",
        },
        now: new Date("2026-02-13T00:00:00.000Z"),
    });
    strict_1.default.equal(result.allowed, false);
    strict_1.default.equal(result.reasonCode, "DELEGATION_OWNER_MISMATCH");
});
(0, node_test_1.default)("resolveCapabilityActor denies missing scope", () => {
    const result = (0, actorResolution_1.resolveCapabilityActor)({
        actorType: "agent",
        actorUid: "agent-1",
        ownerUid: "owner-1",
        capabilityId: "firestore.batch.close",
        principalUid: "staff-uid",
        delegation: {
            delegationId: "del-1",
            agentUid: "agent-1",
            ownerUid: "owner-1",
            scopes: ["capability:hubitat.devices.read:execute"],
            expiresAt: "2026-02-14T00:00:00.000Z",
        },
        now: new Date("2026-02-13T00:00:00.000Z"),
    });
    strict_1.default.equal(result.allowed, false);
    strict_1.default.equal(result.reasonCode, "DELEGATION_SCOPE_MISSING");
});
