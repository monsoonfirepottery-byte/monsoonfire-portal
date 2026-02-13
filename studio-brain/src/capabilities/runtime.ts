import { stableHashDeep } from "../stores/hash";
import type { EventStore } from "../stores/interfaces";
import type { ConnectorRegistry } from "../connectors/registry";
import type { ActionProposal, CapabilityDefinition, KillSwitchState, PolicyExemption } from "./model";
import {
  appendExecutionAudit,
  createProposal,
  evaluateExecution,
  InMemoryQuotaStore,
  type CapabilityActorContext,
  type CapabilityDecision,
  type ExecutionPolicyState,
  type QuotaBucketRecord,
  type QuotaStore,
} from "./policy";

export type ProposalDecisionResult = {
  decision: CapabilityDecision;
  proposal: ActionProposal | null;
};

export type PolicyStateView = {
  killSwitch: KillSwitchState;
  exemptions: PolicyExemption[];
};

export interface PolicyStore {
  getKillSwitchState(now?: Date): Promise<KillSwitchState>;
  setKillSwitch(input: {
    enabled: boolean;
    changedBy: string;
    rationale: string;
    at: Date;
  }): Promise<KillSwitchState>;
  listExemptions(limit: number, now?: Date): Promise<PolicyExemption[]>;
  createExemption(input: {
    capabilityId: string;
    ownerUid?: string;
    justification: string;
    approvedBy: string;
    expiresAt?: string;
    at: Date;
  }): Promise<PolicyExemption>;
  revokeExemption(input: {
    exemptionId: string;
    revokedBy: string;
    reason: string;
    at: Date;
  }): Promise<PolicyExemption | null>;
}

export class CapabilityRuntime {
  constructor(
    private readonly capabilities: CapabilityDefinition[],
    private readonly eventStore: EventStore,
    private readonly proposalStore: ProposalStore = new InMemoryProposalStore(),
    private readonly quotas: QuotaStore = new InMemoryQuotaStore(),
    private readonly policyStore: PolicyStore = new InMemoryPolicyStore(),
    private readonly connectorRegistry: ConnectorRegistry | null = null
  ) {}

  listCapabilities(): CapabilityDefinition[] {
    return [...this.capabilities];
  }

  async getPolicyState(now: Date = new Date()): Promise<PolicyStateView> {
    const [killSwitch, exemptions] = await Promise.all([
      this.policyStore.getKillSwitchState(now),
      this.policyStore.listExemptions(100, now),
    ]);
    return { killSwitch, exemptions };
  }

  async listProposals(limit = 25): Promise<ActionProposal[]> {
    return this.proposalStore.listRecent(Math.max(1, limit));
  }

  async listQuotaBuckets(limit = 50): Promise<QuotaBucketRecord[]> {
    const admin = this.quotas as QuotaStore & {
      listBuckets?: (max: number) => Promise<QuotaBucketRecord[]>;
    };
    if (typeof admin.listBuckets !== "function") return [];
    return admin.listBuckets(Math.max(1, limit));
  }

  async listConnectorHealth(): Promise<Array<{ id: string; ok: boolean; latencyMs: number }>> {
    if (!this.connectorRegistry) return [];
    return this.connectorRegistry.healthAll({ requestId: `health-${Date.now().toString(36)}` });
  }

  async resetQuotaBucket(bucket: string): Promise<boolean> {
    const admin = this.quotas as QuotaStore & {
      resetBucket?: (value: string) => Promise<boolean>;
    };
    if (typeof admin.resetBucket !== "function") return false;
    return admin.resetBucket(bucket);
  }

  async createExemption(
    input: {
      capabilityId: string;
      ownerUid?: string;
      justification: string;
      approvedBy: string;
      expiresAt?: string;
    },
    now: Date = new Date()
  ): Promise<PolicyExemption> {
    const capability = this.capabilities.find((item) => item.id === input.capabilityId);
    if (!capability) {
      throw new Error("Unknown capability.");
    }
    if (input.justification.trim().length < 10) {
      throw new Error("Justification must be at least 10 characters.");
    }
    if (input.expiresAt) {
      const expiresMs = Date.parse(input.expiresAt);
      if (!Number.isFinite(expiresMs) || expiresMs <= now.getTime()) {
        throw new Error("Exemption expiry must be a future ISO timestamp.");
      }
    }

    const exemption = await this.policyStore.createExemption({
      capabilityId: input.capabilityId,
      ownerUid: input.ownerUid,
      justification: input.justification.trim(),
      approvedBy: input.approvedBy,
      expiresAt: input.expiresAt,
      at: now,
    });

    await this.eventStore.append({
      actorType: "staff",
      actorId: input.approvedBy,
      action: "capability.policy.exemption_created",
      rationale: exemption.justification,
      target: "local",
      approvalState: "approved",
      inputHash: stableHashDeep({
        exemptionId: exemption.id,
        capabilityId: exemption.capabilityId,
        ownerUid: exemption.ownerUid ?? null,
      }),
      outputHash: null,
      metadata: {
        exemptionId: exemption.id,
        capabilityId: exemption.capabilityId,
        ownerUid: exemption.ownerUid ?? null,
        expiresAt: exemption.expiresAt ?? null,
      },
    });

    return exemption;
  }

  async revokeExemption(
    exemptionId: string,
    revokedBy: string,
    reason: string,
    now: Date = new Date()
  ): Promise<PolicyExemption | null> {
    if (reason.trim().length < 10) {
      throw new Error("Revocation reason must be at least 10 characters.");
    }
    const revoked = await this.policyStore.revokeExemption({
      exemptionId,
      revokedBy,
      reason: reason.trim(),
      at: now,
    });
    if (!revoked) return null;

    await this.eventStore.append({
      actorType: "staff",
      actorId: revokedBy,
      action: "capability.policy.exemption_revoked",
      rationale: reason.trim(),
      target: "local",
      approvalState: "approved",
      inputHash: stableHashDeep({ exemptionId }),
      outputHash: null,
      metadata: {
        exemptionId,
        revokedBy,
      },
    });

    return revoked;
  }

  async setKillSwitch(enabled: boolean, changedBy: string, rationale: string, now: Date = new Date()): Promise<KillSwitchState> {
    if (rationale.trim().length < 10) {
      throw new Error("Kill switch rationale must be at least 10 characters.");
    }
    const state = await this.policyStore.setKillSwitch({
      enabled,
      changedBy,
      rationale: rationale.trim(),
      at: now,
    });

    await this.eventStore.append({
      actorType: "staff",
      actorId: changedBy,
      action: enabled ? "capability.policy.kill_switch_enabled" : "capability.policy.kill_switch_disabled",
      rationale: rationale.trim(),
      target: "local",
      approvalState: "approved",
      inputHash: stableHashDeep({ enabled }),
      outputHash: null,
      metadata: {
        enabled,
        updatedAt: state.updatedAt,
      },
    });

    return state;
  }

  async create(actor: CapabilityActorContext, input: {
    capabilityId: string;
    rationale: string;
    previewSummary: string;
    requestInput: Record<string, unknown>;
    expectedEffects: string[];
    requestedBy: string;
  }): Promise<ProposalDecisionResult> {
    const result = createProposal(this.capabilities, actor, {
      capabilityId: input.capabilityId,
      rationale: input.rationale,
      previewSummary: input.previewSummary,
      input: input.requestInput,
      expectedEffects: input.expectedEffects,
      requestedBy: input.requestedBy,
    });
    if (result.proposal) {
      await this.proposalStore.save(result.proposal);
      await this.eventStore.append({
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: `capability.${result.proposal.capabilityId}.proposal_created`,
        rationale: result.proposal.rationale,
        target: "local",
        approvalState: result.decision.approvalState,
        inputHash: result.proposal.inputHash,
        outputHash: null,
        metadata: {
          proposalId: result.proposal.id,
          tenantId: result.proposal.tenantId,
          requestedBy: result.proposal.requestedBy,
          reasonCode: result.decision.reasonCode,
        },
      });
    }
    return result;
  }

  async getProposal(id: string): Promise<ActionProposal | null> {
    return this.proposalStore.get(id);
  }

  async approve(id: string, approvedBy: string, rationale: string, now: Date = new Date()): Promise<ActionProposal | null> {
    const proposal = await this.proposalStore.get(id);
    if (!proposal) return null;
    if (proposal.status === "rejected" || proposal.status === "executed") {
      return proposal;
    }
    if (rationale.trim().length < 10) {
      throw new Error("Approval rationale must be at least 10 characters.");
    }
    proposal.status = "approved";
    proposal.approvedBy = approvedBy;
    proposal.approvedAt = now.toISOString();
    await this.proposalStore.save(proposal);
    await this.eventStore.append({
      actorType: "staff",
      actorId: approvedBy,
      action: `capability.${proposal.capabilityId}.proposal_approved`,
      rationale: rationale.trim(),
      target: "local",
      approvalState: "approved",
      inputHash: proposal.inputHash,
      outputHash: null,
      metadata: {
        proposalId: proposal.id,
        tenantId: proposal.tenantId,
        approvedBy,
        approvedAt: proposal.approvedAt,
      },
    });
    return proposal;
  }

  async reject(id: string, rejectedBy: string, reason: string | null = null): Promise<ActionProposal | null> {
    const proposal = await this.proposalStore.get(id);
    if (!proposal) return null;
    if (proposal.status === "executed") {
      return proposal;
    }
    if (!reason || reason.trim().length < 10) {
      throw new Error("Rejection reason must be at least 10 characters.");
    }
    proposal.status = "rejected";
    await this.proposalStore.save(proposal);
    await this.eventStore.append({
      actorType: "staff",
      actorId: rejectedBy,
      action: `capability.${proposal.capabilityId}.proposal_rejected`,
      rationale: reason.trim(),
      target: "local",
      approvalState: "rejected",
      inputHash: proposal.inputHash,
      outputHash: null,
      metadata: {
        proposalId: proposal.id,
        tenantId: proposal.tenantId,
        rejectedBy,
        reason: reason.trim(),
      },
    });
    return proposal;
  }

  async reopen(id: string, reopenedBy: string, reason: string, now: Date = new Date()): Promise<ActionProposal | null> {
    const proposal = await this.proposalStore.get(id);
    if (!proposal) return null;
    if (proposal.status !== "rejected") return proposal;
    if (reason.trim().length < 10) {
      throw new Error("Reopen reason must be at least 10 characters.");
    }
    const capability = this.capabilities.find((item) => item.id === proposal.capabilityId);
    proposal.status = capability?.requiresApproval === false ? "approved" : "pending_approval";
    await this.proposalStore.save(proposal);
    await this.eventStore.append({
      actorType: "staff",
      actorId: reopenedBy,
      action: `capability.${proposal.capabilityId}.proposal_reopened`,
      rationale: reason.trim(),
      target: "local",
      approvalState: "required",
      inputHash: proposal.inputHash,
      outputHash: null,
      metadata: {
        proposalId: proposal.id,
        tenantId: proposal.tenantId,
        reopenedBy,
        reopenedAt: now.toISOString(),
      },
    });
    return proposal;
  }

  async execute(
    id: string,
    actor: CapabilityActorContext,
    output: Record<string, unknown>
  ): Promise<{ proposal: ActionProposal | null; decision: CapabilityDecision }> {
    const proposal = await this.proposalStore.get(id);
    if (!proposal) {
      return {
        proposal: null,
        decision: { allowed: false, reasonCode: "CAPABILITY_UNKNOWN", approvalState: "required" },
      };
    }
    const capability = this.capabilities.find((item) => item.id === proposal.capabilityId);
    if (!capability) {
      return {
        proposal,
        decision: { allowed: false, reasonCode: "CAPABILITY_UNKNOWN", approvalState: "required" },
      };
    }

    const policyState: ExecutionPolicyState = {
      killSwitch: await this.policyStore.getKillSwitchState(),
      exemptions: await this.policyStore.listExemptions(250),
    };
    const decision = await evaluateExecution(this.capabilities, actor, proposal, this.quotas, policyState);
    if (!decision.allowed) {
      return { proposal, decision };
    }

    proposal.status = "executed";
    await this.proposalStore.save(proposal);
    const connectorOutput = await this.readFromMappedConnector(capability.id, proposal.preview.input);
    const finalOutput = connectorOutput ?? output;
    const decoratedOutput = { ...finalOutput, outputHash: stableHashDeep(finalOutput) };
    await appendExecutionAudit(this.eventStore, actor, capability, proposal, decoratedOutput, decision);
    return { proposal, decision };
  }

  private async readFromMappedConnector(
    capabilityId: string,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown> | null> {
    if (!this.connectorRegistry) return null;
    const mapping: Record<string, string> = {
      "hubitat.devices.read": "hubitat",
      "roborock.devices.read": "roborock",
    };
    const connectorId = mapping[capabilityId];
    if (!connectorId) return null;
    const connector = this.connectorRegistry.get(connectorId);
    if (!connector) return null;

    const result = await connector.readStatus(
      {
        requestId: `cap-${Date.now().toString(36)}`,
      },
      input
    );
    return {
      connectorId,
      requestId: result.requestId,
      devices: result.devices,
      rawCount: result.rawCount,
      inputHash: result.inputHash,
      outputHash: result.outputHash,
    };
  }
}

export interface ProposalStore {
  get(id: string): Promise<ActionProposal | null>;
  save(proposal: ActionProposal): Promise<void>;
  listRecent(limit: number): Promise<ActionProposal[]>;
}

export class InMemoryProposalStore implements ProposalStore {
  private readonly proposals = new Map<string, ActionProposal>();

  async get(id: string): Promise<ActionProposal | null> {
    return this.proposals.get(id) ?? null;
  }

  async save(proposal: ActionProposal): Promise<void> {
    this.proposals.set(proposal.id, proposal);
  }

  async listRecent(limit: number): Promise<ActionProposal[]> {
    return [...this.proposals.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, limit));
  }
}

type ExemptionCreateEvent = {
  id: string;
  capabilityId: string;
  ownerUid?: string;
  justification: string;
  approvedBy: string;
  createdAt: string;
  expiresAt?: string;
};

type ExemptionRevokeEvent = {
  exemptionId: string;
  revokedBy: string;
  reason: string;
  revokedAt: string;
};

export class InMemoryPolicyStore implements PolicyStore {
  private readonly createdEvents: ExemptionCreateEvent[] = [];
  private readonly revokedEvents: ExemptionRevokeEvent[] = [];
  private killSwitch: KillSwitchState = {
    enabled: false,
    updatedAt: null,
    updatedBy: null,
    rationale: null,
  };

  async getKillSwitchState(): Promise<KillSwitchState> {
    return { ...this.killSwitch };
  }

  async setKillSwitch(input: {
    enabled: boolean;
    changedBy: string;
    rationale: string;
    at: Date;
  }): Promise<KillSwitchState> {
    this.killSwitch = {
      enabled: input.enabled,
      updatedAt: input.at.toISOString(),
      updatedBy: input.changedBy,
      rationale: input.rationale,
    };
    return { ...this.killSwitch };
  }

  async listExemptions(limit: number, now: Date = new Date()): Promise<PolicyExemption[]> {
    const revokedById = new Map(this.revokedEvents.map((event) => [event.exemptionId, event]));
    return this.createdEvents
      .map((event) => {
        const revoked = revokedById.get(event.id);
        const expiresAtMs = event.expiresAt ? Date.parse(event.expiresAt) : null;
        const expired = expiresAtMs !== null && Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime();
        return {
          id: event.id,
          capabilityId: event.capabilityId,
          ownerUid: event.ownerUid,
          justification: event.justification,
          approvedBy: event.approvedBy,
          createdAt: event.createdAt,
          expiresAt: event.expiresAt,
          revokedAt: revoked?.revokedAt,
          revokedBy: revoked?.revokedBy,
          revokeReason: revoked?.reason,
          status: revoked ? "revoked" : expired ? "expired" : "active",
        } satisfies PolicyExemption;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, limit));
  }

  async createExemption(input: {
    capabilityId: string;
    ownerUid?: string;
    justification: string;
    approvedBy: string;
    expiresAt?: string;
    at: Date;
  }): Promise<PolicyExemption> {
    const event: ExemptionCreateEvent = {
      id: stableHashDeep({
        capabilityId: input.capabilityId,
        ownerUid: input.ownerUid ?? null,
        approvedBy: input.approvedBy,
        at: input.at.toISOString(),
      }).slice(0, 24),
      capabilityId: input.capabilityId,
      ownerUid: input.ownerUid,
      justification: input.justification,
      approvedBy: input.approvedBy,
      createdAt: input.at.toISOString(),
      expiresAt: input.expiresAt,
    };
    this.createdEvents.push(event);
    return {
      id: event.id,
      capabilityId: event.capabilityId,
      ownerUid: event.ownerUid,
      justification: event.justification,
      approvedBy: event.approvedBy,
      createdAt: event.createdAt,
      expiresAt: event.expiresAt,
      status: "active",
    };
  }

  async revokeExemption(input: {
    exemptionId: string;
    revokedBy: string;
    reason: string;
    at: Date;
  }): Promise<PolicyExemption | null> {
    const created = this.createdEvents.find((event) => event.id === input.exemptionId);
    if (!created) return null;
    const existingRevoke = this.revokedEvents.find((event) => event.exemptionId === input.exemptionId);
    if (!existingRevoke) {
      this.revokedEvents.push({
        exemptionId: input.exemptionId,
        revokedBy: input.revokedBy,
        reason: input.reason,
        revokedAt: input.at.toISOString(),
      });
    }

    return {
      id: created.id,
      capabilityId: created.capabilityId,
      ownerUid: created.ownerUid,
      justification: created.justification,
      approvedBy: created.approvedBy,
      createdAt: created.createdAt,
      expiresAt: created.expiresAt,
      revokedAt: existingRevoke?.revokedAt ?? input.at.toISOString(),
      revokedBy: existingRevoke?.revokedBy ?? input.revokedBy,
      revokeReason: existingRevoke?.reason ?? input.reason,
      status: "revoked",
    };
  }
}

export const defaultCapabilities: CapabilityDefinition[] = [
  {
    id: "firestore.ops_note.append",
    target: "firestore",
    description: "Append a staff-visible pilot ops note to a batch resource.",
    readOnly: false,
    requiresApproval: true,
    maxCallsPerHour: 8,
    risk: "medium",
  },
  {
    id: "firestore.batch.close",
    target: "firestore",
    description: "Close a kiln batch after approved review.",
    readOnly: false,
    requiresApproval: true,
    maxCallsPerHour: 5,
    risk: "high",
  },
  {
    id: "finance.reconciliation.adjust",
    target: "firestore",
    description: "Create a proposal for finance reconciliation corrections (staff-reviewed).",
    readOnly: false,
    requiresApproval: true,
    maxCallsPerHour: 5,
    risk: "medium",
  },
  {
    id: "hubitat.devices.read",
    target: "hubitat",
    description: "Read connector status for ops dashboard.",
    readOnly: true,
    requiresApproval: false,
    maxCallsPerHour: 120,
    risk: "low",
  },
  {
    id: "roborock.devices.read",
    target: "roborock",
    description: "Read Roborock device status and battery telemetry.",
    readOnly: true,
    requiresApproval: false,
    maxCallsPerHour: 120,
    risk: "low",
  },
];
