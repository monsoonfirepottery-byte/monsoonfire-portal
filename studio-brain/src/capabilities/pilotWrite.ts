export type PilotDryRunPlan = {
  actionType: "ops_note_append";
  ownerUid: string;
  resourceCollection: "batches";
  resourceId: string;
  notePreview: string;
};

export type PilotExecutionResult = {
  idempotencyKey: string;
  proposalId: string;
  resourcePointer: {
    collection: string;
    docId: string;
  };
  replayed: boolean;
};

export interface PilotWriteExecutor {
  dryRun(input: Record<string, unknown>): PilotDryRunPlan;
  execute(input: {
    proposalId: string;
    approvedBy: string | null;
    approvedAt: string | null;
    idempotencyKey: string;
    actorUid: string;
    pilotInput: Record<string, unknown>;
    authorizationHeader?: string;
    adminToken?: string;
  }): Promise<PilotExecutionResult>;
  rollback(input: {
    proposalId: string;
    idempotencyKey: string;
    reason: string;
    actorUid: string;
    authorizationHeader?: string;
    adminToken?: string;
  }): Promise<{ ok: true; replayed: boolean }>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${name}.`);
  }
  return value.trim();
}

export function buildPilotDryRun(input: Record<string, unknown>): PilotDryRunPlan {
  const actionType = requiredString(input.actionType, "actionType");
  if (actionType !== "ops_note_append") {
    throw new Error("Unsupported pilot actionType.");
  }
  const ownerUid = requiredString(input.ownerUid, "ownerUid");
  const resourceCollection = requiredString(input.resourceCollection, "resourceCollection");
  if (resourceCollection !== "batches") {
    throw new Error("Pilot resourceCollection must be batches.");
  }
  const resourceId = requiredString(input.resourceId, "resourceId");
  const note = requiredString(input.note, "note");
  if (note.length < 5) {
    throw new Error("Pilot note must be at least 5 characters.");
  }
  return {
    actionType: "ops_note_append",
    ownerUid,
    resourceCollection: "batches",
    resourceId,
    notePreview: note.slice(0, 140),
  };
}

