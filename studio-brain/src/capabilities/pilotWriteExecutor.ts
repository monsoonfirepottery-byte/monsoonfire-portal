import { buildPilotDryRun, type PilotExecutionResult, type PilotWriteExecutor } from "./pilotWrite";

type CreatePilotWriteExecutorOptions = {
  functionsBaseUrl: string;
};

export function createPilotWriteExecutor(options: CreatePilotWriteExecutorOptions): PilotWriteExecutor {
  const baseUrl = options.functionsBaseUrl.replace(/\/+$/, "");

  return {
    dryRun(input) {
      return buildPilotDryRun(input);
    },
    async execute(input): Promise<PilotExecutionResult> {
      const plan = buildPilotDryRun(input.pilotInput);
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (input.authorizationHeader) headers.authorization = input.authorizationHeader;
      if (input.adminToken) headers["x-admin-token"] = input.adminToken;
      const response = await fetch(`${baseUrl}/executeStudioBrainPilotAction`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          proposalId: input.proposalId,
          approvedBy: input.approvedBy,
          approvedAt: input.approvedAt,
          idempotencyKey: input.idempotencyKey,
          actorUid: input.actorUid,
          actionType: plan.actionType,
          ownerUid: plan.ownerUid,
          resourceCollection: plan.resourceCollection,
          resourceId: plan.resourceId,
          note: String(input.pilotInput.note ?? ""),
        }),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        message?: string;
        replayed?: boolean;
        resourcePointer?: { collection?: string; docId?: string };
      };
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? `Pilot execution failed (${response.status}).`);
      }
      return {
        idempotencyKey: input.idempotencyKey,
        proposalId: input.proposalId,
        resourcePointer: {
          collection: String(payload.resourcePointer?.collection ?? ""),
          docId: String(payload.resourcePointer?.docId ?? ""),
        },
        replayed: payload.replayed === true,
      };
    },
    async rollback(input): Promise<{ ok: true; replayed: boolean }> {
      const headers: Record<string, string> = {
        "content-type": "application/json",
      };
      if (input.authorizationHeader) headers.authorization = input.authorizationHeader;
      if (input.adminToken) headers["x-admin-token"] = input.adminToken;
      const response = await fetch(`${baseUrl}/rollbackStudioBrainPilotAction`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          proposalId: input.proposalId,
          idempotencyKey: input.idempotencyKey,
          reason: input.reason,
          actorUid: input.actorUid,
        }),
      });
      const payload = (await response.json()) as { ok?: boolean; message?: string; replayed?: boolean };
      if (!response.ok || payload.ok !== true) {
        throw new Error(payload.message ?? `Pilot rollback failed (${response.status}).`);
      }
      return { ok: true, replayed: payload.replayed === true };
    },
  };
}

