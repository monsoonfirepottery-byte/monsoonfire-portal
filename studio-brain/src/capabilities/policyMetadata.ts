export type CapabilityPolicyMetadata = {
  owner: string;
  approvalMode: "required" | "exempt";
  rollbackPlan: string;
  escalationPath: string;
};

export const capabilityPolicyMetadata: Record<string, CapabilityPolicyMetadata> = {
  "firestore.ops_note.append": {
    owner: "Studio Ops",
    approvalMode: "required",
    rollbackPlan: "Invoke pilot rollback with the same idempotency key and record a rollback reason.",
    escalationPath: "Route pilot write exceptions to governance-primary plus ops-primary with proposal and idempotency evidence.",
  },
  "firestore.batch.close": {
    owner: "Studio Ops",
    approvalMode: "required",
    rollbackPlan: "Reopen batch via staff console and append corrective audit rationale.",
    escalationPath: "Route exemption request to governance-primary with incident ID and rollback evidence.",
  },
  "finance.reconciliation.adjust": {
    owner: "Finance Ops",
    approvalMode: "required",
    rollbackPlan: "Reverse correction proposal and re-sync with Stripe records.",
    escalationPath: "Route reconciliation exceptions to ops-primary + finance-primary.",
  },
  "hubitat.devices.read": {
    owner: "Integrations",
    approvalMode: "exempt",
    rollbackPlan: "Disable connector in registry and fall back to manual status checks.",
    escalationPath: "Route connector policy exception to platform-primary.",
  },
  "roborock.devices.read": {
    owner: "Integrations",
    approvalMode: "exempt",
    rollbackPlan: "Disable connector in registry and use direct vendor app telemetry.",
    escalationPath: "Route connector policy exception to platform-primary.",
  },
};
