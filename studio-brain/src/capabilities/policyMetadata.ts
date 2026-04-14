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
  "support.billing.adjustment": {
    owner: "Support Ops",
    approvalMode: "required",
    rollbackPlan: "Revoke the proposed billing action, preserve the case audit trail, and confirm the member-facing thread stays unchanged until manual review.",
    escalationPath: "Route billing exception requests to support-primary + finance-primary with support case and message evidence.",
  },
  "support.reservation.override": {
    owner: "Support Ops",
    approvalMode: "required",
    rollbackPlan: "Cancel the proposed reservation change, restore the prior queue state, and record the rationale on the mirrored support case.",
    escalationPath: "Route reservation exceptions to support-primary + studio-ops-primary with queue evidence.",
  },
  "support.queue.override": {
    owner: "Support Ops",
    approvalMode: "required",
    rollbackPlan: "Withdraw the queue/deadline proposal, preserve the original ordering, and note the blocked promise in the support audit trail.",
    escalationPath: "Route queue or deadline guarantee requests to support-primary + kiln-ops-primary.",
  },
  "support.access.exception": {
    owner: "Trust & Safety",
    approvalMode: "required",
    rollbackPlan: "Void the access exception proposal, rotate any affected credentials outside the email channel, and keep the case in security hold.",
    escalationPath: "Route access exception or credential requests to trust-safety-primary + ops-primary immediately.",
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
  "roborock.clean.start_full": {
    owner: "Integrations",
    approvalMode: "required",
    rollbackPlan: "Issue stop command in vendor app and reschedule cleaning window.",
    escalationPath: "Route automation failures to platform-primary + ops-primary with request payload evidence.",
  },
  "roborock.clean.start_rooms": {
    owner: "Integrations",
    approvalMode: "required",
    rollbackPlan: "Issue stop command in vendor app and relaunch targeted room batch.",
    escalationPath: "Route room-clean policy exceptions to platform-primary + ops-primary.",
  },
};
