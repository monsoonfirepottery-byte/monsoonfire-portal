export type CapabilityRisk = "low" | "medium" | "high" | "critical";

export type CapabilityDefinition = {
  id: string;
  target: "firestore" | "stripe" | "hubitat" | "roborock" | "website";
  description: string;
  readOnly: boolean;
  requiresApproval: boolean;
  policyExemptionId?: string;
  maxCallsPerHour: number;
  risk: CapabilityRisk;
};

export type ActionProposal = {
  id: string;
  createdAt: string;
  requestedBy: string;
  tenantId: string;
  capabilityId: string;
  rationale: string;
  inputHash: string;
  preview: {
    summary: string;
    input: Record<string, unknown>;
    expectedEffects: string[];
  };
  status: "draft" | "pending_approval" | "approved" | "rejected" | "executed";
  approvedBy?: string;
  approvedAt?: string;
};

export type PolicyExemption = {
  id: string;
  capabilityId: string;
  ownerUid?: string;
  justification: string;
  approvedBy: string;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokeReason?: string;
  status: "active" | "revoked" | "expired";
};

export type KillSwitchState = {
  enabled: boolean;
  updatedAt: string | null;
  updatedBy: string | null;
  rationale: string | null;
};
