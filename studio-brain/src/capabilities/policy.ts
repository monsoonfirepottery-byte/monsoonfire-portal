import type { ApprovalState } from "../types/core";
import { stableHashDeep } from "../stores/hash";
import type { EventStore } from "../stores/interfaces";
import type { ActionProposal, CapabilityDefinition, KillSwitchState, PolicyExemption } from "./model";

export type CapabilityActorContext = {
  actorType: "human" | "staff" | "agent" | "system";
  actorId: string;
  ownerUid: string;
  tenantId?: string;
  effectiveScopes: string[];
};

export type CapabilityProposalInput = {
  capabilityId: string;
  rationale: string;
  previewSummary: string;
  input: Record<string, unknown>;
  expectedEffects: string[];
  requestedBy: string;
};

export type CapabilityDecision = {
  allowed: boolean;
  reasonCode:
    | "ALLOWED"
    | "CAPABILITY_UNKNOWN"
    | "DELEGATION_SCOPE_MISSING"
    | "RATIONALE_REQUIRED"
    | "APPROVAL_REQUIRED"
    | "PROPOSAL_REJECTED"
    | "PROPOSAL_CAPABILITY_MISMATCH"
    | "RATE_LIMITED"
    | "BLOCKED_BY_POLICY"
    | "TENANT_MISMATCH";
  approvalState: ApprovalState;
  retryAfterSeconds?: number;
};

export type QuotaResult = {
  allowed: boolean;
  retryAfterSeconds: number;
  remaining: number;
};

export type QuotaBucketRecord = {
  bucket: string;
  windowStart: string;
  count: number;
};

export interface QuotaStore {
  consume(bucket: string, limit: number, windowSeconds: number, nowMs: number): Promise<QuotaResult>;
}

export interface QuotaAdminStore extends QuotaStore {
  listBuckets(limit: number): Promise<QuotaBucketRecord[]>;
  resetBucket(bucket: string): Promise<boolean>;
}

export type ExecutionPolicyState = {
  killSwitch: KillSwitchState;
  exemptions: PolicyExemption[];
};

type QuotaBucket = {
  count: number;
  windowStartMs: number;
};

export class InMemoryQuotaStore implements QuotaStore {
  private readonly buckets = new Map<string, QuotaBucket>();

  async consume(bucket: string, limit: number, windowSeconds: number, nowMs: number): Promise<QuotaResult> {
    const windowMs = windowSeconds * 1000;
    const existing = this.buckets.get(bucket);
    if (!existing || nowMs - existing.windowStartMs >= windowMs) {
      this.buckets.set(bucket, { count: 1, windowStartMs: nowMs });
      return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - 1) };
    }

    if (existing.count >= limit) {
      const elapsedMs = nowMs - existing.windowStartMs;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
      return { allowed: false, retryAfterSeconds, remaining: 0 };
    }

    existing.count += 1;
    this.buckets.set(bucket, existing);
    return { allowed: true, retryAfterSeconds: 0, remaining: Math.max(0, limit - existing.count) };
  }

  async listBuckets(limit: number): Promise<QuotaBucketRecord[]> {
    return [...this.buckets.entries()]
      .map(([bucket, row]) => ({
        bucket,
        windowStart: new Date(row.windowStartMs).toISOString(),
        count: row.count,
      }))
      .sort((a, b) => b.windowStart.localeCompare(a.windowStart))
      .slice(0, Math.max(1, limit));
  }

  async resetBucket(bucket: string): Promise<boolean> {
    return this.buckets.delete(bucket);
  }
}

function hasRequiredScope(actor: CapabilityActorContext, capabilityId: string): boolean {
  if (actor.actorType !== "agent") {
    return true;
  }
  const exact = `capability:${capabilityId}:execute`;
  return actor.effectiveScopes.includes(exact) || actor.effectiveScopes.includes("capability:*:execute");
}

function createProposalId(capabilityId: string, requestedBy: string, atIso: string): string {
  return stableHashDeep({ capabilityId, requestedBy, atIso }).slice(0, 24);
}

export function createProposal(
  capabilities: CapabilityDefinition[],
  actor: CapabilityActorContext,
  input: CapabilityProposalInput,
  now: Date = new Date()
): { decision: CapabilityDecision; proposal: ActionProposal | null } {
  const capability = capabilities.find((item) => item.id === input.capabilityId);
  if (!capability) {
    return { decision: { allowed: false, reasonCode: "CAPABILITY_UNKNOWN", approvalState: "required" }, proposal: null };
  }

  if (!hasRequiredScope(actor, capability.id)) {
    return { decision: { allowed: false, reasonCode: "DELEGATION_SCOPE_MISSING", approvalState: "required" }, proposal: null };
  }

  if (input.rationale.trim().length < 10) {
    return { decision: { allowed: false, reasonCode: "RATIONALE_REQUIRED", approvalState: "required" }, proposal: null };
  }

  const createdAt = now.toISOString();
  const inputHash = stableHashDeep(input.input);
  const status = capability.requiresApproval ? "pending_approval" : "approved";
  const tenantIdRaw = typeof input.input.tenantId === "string" ? input.input.tenantId.trim() : "";
  const tenantId = tenantIdRaw || actor.tenantId || actor.ownerUid;
  const proposal: ActionProposal = {
    id: createProposalId(capability.id, input.requestedBy, createdAt),
    createdAt,
    requestedBy: input.requestedBy,
    tenantId,
    capabilityId: capability.id,
    rationale: input.rationale,
    inputHash,
    preview: {
      summary: input.previewSummary,
      input: input.input,
      expectedEffects: input.expectedEffects,
    },
    status,
    approvedBy: status === "approved" ? "system:auto" : undefined,
    approvedAt: status === "approved" ? createdAt : undefined,
  };

  return {
    decision: {
      allowed: true,
      reasonCode: "ALLOWED",
      approvalState: capability.requiresApproval ? "required" : "exempt",
    },
    proposal,
  };
}

export async function evaluateExecution(
  capabilities: CapabilityDefinition[],
  actor: CapabilityActorContext,
  proposal: ActionProposal,
  quotas: QuotaStore,
  policyState: ExecutionPolicyState,
  now: Date = new Date()
): Promise<CapabilityDecision> {
  const capability = capabilities.find((item) => item.id === proposal.capabilityId);
  if (!capability) {
    return { allowed: false, reasonCode: "CAPABILITY_UNKNOWN", approvalState: "required" };
  }

  if (!hasRequiredScope(actor, capability.id)) {
    return { allowed: false, reasonCode: "DELEGATION_SCOPE_MISSING", approvalState: "required" };
  }

  if (policyState.killSwitch.enabled) {
    return { allowed: false, reasonCode: "BLOCKED_BY_POLICY", approvalState: "required" };
  }

  if (proposal.capabilityId !== capability.id) {
    return { allowed: false, reasonCode: "PROPOSAL_CAPABILITY_MISMATCH", approvalState: "required" };
  }
  const actorTenantId = actor.tenantId ?? actor.ownerUid;
  if (proposal.tenantId !== actorTenantId) {
    return { allowed: false, reasonCode: "TENANT_MISMATCH", approvalState: "required" };
  }

  if (proposal.status === "rejected") {
    return { allowed: false, reasonCode: "PROPOSAL_REJECTED", approvalState: "rejected" };
  }

  const activeExemption = policyState.exemptions.find((exemption) => {
    if (exemption.capabilityId !== capability.id || exemption.status !== "active") return false;
    if (!exemption.ownerUid) return true;
    return exemption.ownerUid === actor.ownerUid;
  });

  if (capability.requiresApproval && proposal.status !== "approved" && !activeExemption) {
    return { allowed: false, reasonCode: "APPROVAL_REQUIRED", approvalState: "required" };
  }

  const quota = await quotas.consume(
    `actor:${actor.ownerUid}:${actor.actorId}:capability:${capability.id}`,
    Math.max(1, capability.maxCallsPerHour),
    3600,
    now.getTime()
  );
  if (!quota.allowed) {
    return {
      allowed: false,
      reasonCode: "RATE_LIMITED",
      approvalState: capability.requiresApproval && !activeExemption ? "approved" : "exempt",
      retryAfterSeconds: quota.retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    reasonCode: "ALLOWED",
    approvalState: capability.requiresApproval && !activeExemption ? "approved" : "exempt",
  };
}

export async function appendExecutionAudit(
  eventStore: EventStore,
  actor: CapabilityActorContext,
  capability: CapabilityDefinition,
  proposal: ActionProposal,
  output: Record<string, unknown>,
  decision: CapabilityDecision
): Promise<void> {
  const outputHash = stableHashDeep(output);
  await eventStore.append({
    actorType: actor.actorType,
    actorId: actor.actorId,
    action: `capability.${capability.id}.executed`,
    rationale: proposal.rationale,
    target: capability.target,
    approvalState: decision.approvalState,
    inputHash: proposal.inputHash,
    outputHash,
    metadata: {
      capabilityId: capability.id,
      tenantId: proposal.tenantId,
      reasonCode: decision.reasonCode,
      retryAfterSeconds: decision.retryAfterSeconds ?? null,
      proposalId: proposal.id,
    },
  });
}
