"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const policyLint_1 = require("./policyLint");
(0, node_test_1.default)("policy lint passes for compliant capability metadata", () => {
    const capabilities = [
        {
            id: "hubitat.devices.read",
            target: "hubitat",
            description: "read",
            readOnly: true,
            requiresApproval: false,
            maxCallsPerHour: 10,
            risk: "low",
        },
    ];
    const issues = (0, policyLint_1.lintCapabilityPolicy)(capabilities, {
        "hubitat.devices.read": {
            owner: "Integrations",
            approvalMode: "exempt",
            rollbackPlan: "Disable connector",
            escalationPath: "platform-primary",
        },
    });
    strict_1.default.equal(issues.length, 0);
});
(0, node_test_1.default)("policy lint fails when write capability is exempt or missing fields", () => {
    const capabilities = [
        {
            id: "firestore.batch.close",
            target: "firestore",
            description: "write",
            readOnly: false,
            requiresApproval: true,
            maxCallsPerHour: 5,
            risk: "high",
        },
    ];
    const issues = (0, policyLint_1.lintCapabilityPolicy)(capabilities, {
        "firestore.batch.close": {
            owner: "",
            approvalMode: "exempt",
            rollbackPlan: "",
            escalationPath: "",
        },
    });
    strict_1.default.ok(issues.some((issue) => issue.code === "MISSING_OWNER"));
    strict_1.default.ok(issues.some((issue) => issue.code === "MISSING_ROLLBACK_PLAN"));
    strict_1.default.ok(issues.some((issue) => issue.code === "MISSING_ESCALATION_PATH"));
    strict_1.default.ok(issues.some((issue) => issue.code === "APPROVAL_MODE_MISMATCH"));
    strict_1.default.ok(issues.some((issue) => issue.code === "WRITE_CAPABILITY_EXEMPT"));
});
