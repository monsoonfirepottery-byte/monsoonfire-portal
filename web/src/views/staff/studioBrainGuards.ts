export function canApproveProposalAction(input: {
  busy: boolean;
  disabledByToken: boolean;
  approvalRationale: string;
}): boolean {
  if (input.busy) return false;
  if (input.disabledByToken) return false;
  return input.approvalRationale.trim().length > 0;
}

export function canExecuteProposalAction(input: {
  busy: boolean;
  disabledByToken: boolean;
}): boolean {
  return !input.busy && !input.disabledByToken;
}

export function canRollbackProposalAction(input: {
  busy: boolean;
  disabledByToken: boolean;
  proposalStatus: string;
  rollbackReason: string;
  idempotencyKey: string;
}): boolean {
  if (input.busy) return false;
  if (input.disabledByToken) return false;
  if (input.proposalStatus !== "executed") return false;
  if (input.rollbackReason.trim().length < 10) return false;
  return input.idempotencyKey.trim().length >= 8;
}

export function buildProposalIdempotencyKey(input: {
  manualKey: string;
  proposalId: string;
  nowMs: number;
}): string {
  const manual = input.manualKey.trim();
  if (manual) return manual;
  return `pilot-${input.proposalId.slice(0, 8)}-${input.nowMs}`;
}

export function buildPilotExecutePayload(input: {
  userUid: string;
  tenantContext: string;
  idempotencyKey: string;
}): {
  actorType: "staff";
  actorId: string;
  ownerUid: string;
  tenantId: string;
  idempotencyKey: string;
  output: { executedFrom: "staff-console" };
} {
  const tenantId = input.tenantContext.trim() || input.userUid;
  return {
    actorType: "staff",
    actorId: input.userUid,
    ownerUid: input.userUid,
    tenantId,
    idempotencyKey: input.idempotencyKey.trim(),
    output: { executedFrom: "staff-console" },
  };
}

export function buildPilotRollbackPayload(input: {
  idempotencyKey: string;
  reason: string;
}): {
  idempotencyKey: string;
  reason: string;
} {
  return {
    idempotencyKey: input.idempotencyKey.trim(),
    reason: input.reason.trim(),
  };
}
