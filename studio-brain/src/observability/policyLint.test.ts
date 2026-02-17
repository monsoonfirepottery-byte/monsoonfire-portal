import test from "node:test";
import assert from "node:assert/strict";
import { lintCapabilityPolicy } from "./policyLint";
import type { CapabilityDefinition } from "../capabilities/model";

test("policy lint passes for compliant capability metadata", () => {
  const capabilities: CapabilityDefinition[] = [
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
  const issues = lintCapabilityPolicy(capabilities, {
    "hubitat.devices.read": {
      owner: "Integrations",
      approvalMode: "exempt",
      rollbackPlan: "Disable connector",
      escalationPath: "platform-primary",
    },
  });
  assert.equal(issues.length, 0);
});

test("policy lint fails when write capability is exempt or missing fields", () => {
  const capabilities: CapabilityDefinition[] = [
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
  const issues = lintCapabilityPolicy(capabilities, {
    "firestore.batch.close": {
      owner: "",
      approvalMode: "exempt",
      rollbackPlan: "",
      escalationPath: "",
    },
  });
  assert.ok(issues.some((issue) => issue.code === "MISSING_OWNER"));
  assert.ok(issues.some((issue) => issue.code === "MISSING_ROLLBACK_PLAN"));
  assert.ok(issues.some((issue) => issue.code === "MISSING_ESCALATION_PATH"));
  assert.ok(issues.some((issue) => issue.code === "APPROVAL_MODE_MISMATCH"));
  assert.ok(issues.some((issue) => issue.code === "WRITE_CAPABILITY_EXEMPT"));
});
