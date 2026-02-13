"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPilotWriteExecutor = createPilotWriteExecutor;
const pilotWrite_1 = require("./pilotWrite");
function createPilotWriteExecutor(options) {
    const baseUrl = options.functionsBaseUrl.replace(/\/+$/, "");
    return {
        dryRun(input) {
            return (0, pilotWrite_1.buildPilotDryRun)(input);
        },
        async execute(input) {
            const plan = (0, pilotWrite_1.buildPilotDryRun)(input.pilotInput);
            const headers = {
                "content-type": "application/json",
            };
            if (input.authorizationHeader)
                headers.authorization = input.authorizationHeader;
            if (input.adminToken)
                headers["x-admin-token"] = input.adminToken;
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
            const payload = (await response.json());
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
        async rollback(input) {
            const headers = {
                "content-type": "application/json",
            };
            if (input.authorizationHeader)
                headers.authorization = input.authorizationHeader;
            if (input.adminToken)
                headers["x-admin-token"] = input.adminToken;
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
            const payload = (await response.json());
            if (!response.ok || payload.ok !== true) {
                throw new Error(payload.message ?? `Pilot rollback failed (${response.status}).`);
            }
            return { ok: true, replayed: payload.replayed === true };
        },
    };
}
