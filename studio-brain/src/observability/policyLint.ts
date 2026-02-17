import type { CapabilityDefinition } from "../capabilities/model";
import type { CapabilityPolicyMetadata } from "../capabilities/policyMetadata";

export type PolicyLintIssue = {
  capabilityId: string;
  code:
    | "MISSING_METADATA"
    | "MISSING_OWNER"
    | "MISSING_ROLLBACK_PLAN"
    | "MISSING_ESCALATION_PATH"
    | "RISK_MISSING"
    | "APPROVAL_MODE_MISMATCH"
    | "WRITE_CAPABILITY_EXEMPT";
  message: string;
};

export function lintCapabilityPolicy(
  capabilities: CapabilityDefinition[],
  metadataById: Record<string, CapabilityPolicyMetadata>
): PolicyLintIssue[] {
  const issues: PolicyLintIssue[] = [];
  for (const capability of capabilities) {
    const metadata = metadataById[capability.id];
    if (!metadata) {
      issues.push({
        capabilityId: capability.id,
        code: "MISSING_METADATA",
        message: "Capability policy metadata is missing.",
      });
      continue;
    }
    if (!capability.risk) {
      issues.push({
        capabilityId: capability.id,
        code: "RISK_MISSING",
        message: "Capability must declare risk tier.",
      });
    }
    if (!metadata.owner.trim()) {
      issues.push({
        capabilityId: capability.id,
        code: "MISSING_OWNER",
        message: "Capability metadata owner is required.",
      });
    }
    if (!metadata.rollbackPlan.trim()) {
      issues.push({
        capabilityId: capability.id,
        code: "MISSING_ROLLBACK_PLAN",
        message: "Capability metadata rollback plan is required.",
      });
    }
    if (!metadata.escalationPath.trim()) {
      issues.push({
        capabilityId: capability.id,
        code: "MISSING_ESCALATION_PATH",
        message: "Capability metadata escalation path is required.",
      });
    }
    const expectedMode = capability.requiresApproval ? "required" : "exempt";
    if (metadata.approvalMode !== expectedMode) {
      issues.push({
        capabilityId: capability.id,
        code: "APPROVAL_MODE_MISMATCH",
        message: `approvalMode=${metadata.approvalMode} but capability requiresApproval=${capability.requiresApproval}.`,
      });
    }
    if (!capability.readOnly && metadata.approvalMode !== "required") {
      issues.push({
        capabilityId: capability.id,
        code: "WRITE_CAPABILITY_EXEMPT",
        message: "Write-capable capability cannot be exempt from approval.",
      });
    }
  }
  return issues;
}
