import type { CapabilityActorContext } from "./policy";

export type DelegationPayload = {
  delegationId?: string;
  agentUid?: string;
  ownerUid?: string;
  scopes?: string[];
  issuedAt?: string;
  expiresAt?: string;
  revokedAt?: string;
};

export type DelegationDecision = {
  allowed: boolean;
  reasonCode:
    | "ALLOWED"
    | "DELEGATION_MISSING"
    | "DELEGATION_EXPIRED"
    | "DELEGATION_REVOKED"
    | "DELEGATION_OWNER_MISMATCH"
    | "DELEGATION_ACTOR_MISMATCH"
    | "DELEGATION_SCOPE_MISSING";
  actor: CapabilityActorContext | null;
  trace: {
    actorType: CapabilityActorContext["actorType"];
    actorUid: string;
    ownerUid: string;
    tenantId: string;
    effectiveScopes: string[];
    delegationId: string | null;
  };
};

function hasExecuteScope(scopes: string[], capabilityId: string): boolean {
  return scopes.includes(`capability:${capabilityId}:execute`) || scopes.includes("capability:*:execute");
}

export function resolveCapabilityActor(input: {
  actorType?: string;
  actorUid?: string;
  ownerUid?: string;
  capabilityId: string;
  principalUid: string;
  delegation?: DelegationPayload;
  tenantId?: string;
  now?: Date;
}): DelegationDecision {
  const actorType = (input.actorType === "agent" ? "agent" : "staff") as CapabilityActorContext["actorType"];

  if (actorType !== "agent") {
    const actorUid = input.principalUid;
    const ownerUid = input.principalUid;
    const tenantId = (input.tenantId ?? ownerUid).trim();
    return {
      allowed: true,
      reasonCode: "ALLOWED",
      actor: {
        actorType: "staff",
        actorId: actorUid,
        ownerUid,
        tenantId,
        effectiveScopes: ["capability:*:execute"],
      },
      trace: {
        actorType: "staff",
        actorUid,
        ownerUid,
        tenantId,
        effectiveScopes: ["capability:*:execute"],
        delegationId: null,
      },
    };
  }

  const nowMs = (input.now ?? new Date()).getTime();
  const actorUid = (input.actorUid ?? "").trim();
  const ownerUid = (input.ownerUid ?? "").trim();
  const tenantId = (input.tenantId ?? ownerUid).trim();
  const delegation = input.delegation;

  const traceBase = {
    actorType: "agent" as const,
    actorUid,
    ownerUid,
    tenantId,
    effectiveScopes: Array.isArray(delegation?.scopes) ? delegation?.scopes.map((scope) => String(scope)) : [],
    delegationId: delegation?.delegationId ? String(delegation.delegationId) : null,
  };

  if (!delegation) {
    return { allowed: false, reasonCode: "DELEGATION_MISSING", actor: null, trace: traceBase };
  }

  if (delegation.revokedAt) {
    return { allowed: false, reasonCode: "DELEGATION_REVOKED", actor: null, trace: traceBase };
  }

  if (delegation.expiresAt) {
    const expiresMs = Date.parse(String(delegation.expiresAt));
    if (!Number.isFinite(expiresMs) || expiresMs <= nowMs) {
      return { allowed: false, reasonCode: "DELEGATION_EXPIRED", actor: null, trace: traceBase };
    }
  }

  const delegatedAgentUid = (delegation.agentUid ?? "").trim();
  if (!actorUid || !delegatedAgentUid || delegatedAgentUid !== actorUid) {
    return { allowed: false, reasonCode: "DELEGATION_ACTOR_MISMATCH", actor: null, trace: traceBase };
  }

  const delegatedOwnerUid = (delegation.ownerUid ?? "").trim();
  if (!ownerUid || !delegatedOwnerUid || delegatedOwnerUid !== ownerUid) {
    return { allowed: false, reasonCode: "DELEGATION_OWNER_MISMATCH", actor: null, trace: traceBase };
  }

  const effectiveScopes = Array.isArray(delegation.scopes) ? delegation.scopes.map((scope) => String(scope)) : [];
  if (!hasExecuteScope(effectiveScopes, input.capabilityId)) {
    return { allowed: false, reasonCode: "DELEGATION_SCOPE_MISSING", actor: null, trace: traceBase };
  }

  return {
    allowed: true,
    reasonCode: "ALLOWED",
    actor: {
      actorType: "agent",
      actorId: actorUid,
      ownerUid,
      tenantId,
      effectiveScopes,
    },
    trace: {
      actorType: "agent",
      actorUid,
      ownerUid,
      tenantId,
      effectiveScopes,
      delegationId: delegation.delegationId ? String(delegation.delegationId) : null,
    },
  };
}
