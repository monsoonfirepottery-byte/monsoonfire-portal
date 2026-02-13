"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryQuotaStore = void 0;
exports.createProposal = createProposal;
exports.evaluateExecution = evaluateExecution;
exports.appendExecutionAudit = appendExecutionAudit;
const hash_1 = require("../stores/hash");
class InMemoryQuotaStore {
    buckets = new Map();
    async consume(bucket, limit, windowSeconds, nowMs) {
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
    async listBuckets(limit) {
        return [...this.buckets.entries()]
            .map(([bucket, row]) => ({
            bucket,
            windowStart: new Date(row.windowStartMs).toISOString(),
            count: row.count,
        }))
            .sort((a, b) => b.windowStart.localeCompare(a.windowStart))
            .slice(0, Math.max(1, limit));
    }
    async resetBucket(bucket) {
        return this.buckets.delete(bucket);
    }
}
exports.InMemoryQuotaStore = InMemoryQuotaStore;
function hasRequiredScope(actor, capabilityId) {
    if (actor.actorType !== "agent") {
        return true;
    }
    const exact = `capability:${capabilityId}:execute`;
    return actor.effectiveScopes.includes(exact) || actor.effectiveScopes.includes("capability:*:execute");
}
function createProposalId(capabilityId, requestedBy, atIso) {
    return (0, hash_1.stableHashDeep)({ capabilityId, requestedBy, atIso }).slice(0, 24);
}
function createProposal(capabilities, actor, input, now = new Date()) {
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
    const inputHash = (0, hash_1.stableHashDeep)(input.input);
    const status = capability.requiresApproval ? "pending_approval" : "approved";
    const tenantIdRaw = typeof input.input.tenantId === "string" ? input.input.tenantId.trim() : "";
    const tenantId = tenantIdRaw || actor.tenantId || actor.ownerUid;
    const proposal = {
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
async function evaluateExecution(capabilities, actor, proposal, quotas, policyState, now = new Date()) {
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
        if (exemption.capabilityId !== capability.id || exemption.status !== "active")
            return false;
        if (!exemption.ownerUid)
            return true;
        return exemption.ownerUid === actor.ownerUid;
    });
    if (capability.requiresApproval && proposal.status !== "approved" && !activeExemption) {
        return { allowed: false, reasonCode: "APPROVAL_REQUIRED", approvalState: "required" };
    }
    const quota = await quotas.consume(`actor:${actor.ownerUid}:${actor.actorId}:capability:${capability.id}`, Math.max(1, capability.maxCallsPerHour), 3600, now.getTime());
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
async function appendExecutionAudit(eventStore, actor, capability, proposal, output, decision) {
    const outputHash = (0, hash_1.stableHashDeep)(output);
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
