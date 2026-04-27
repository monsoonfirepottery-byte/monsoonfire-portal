"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordOperatorAction = recordOperatorAction;
const node_crypto_1 = __importDefault(require("node:crypto"));
const hash_1 = require("../../stores/hash");
const orchestration_1 = require("./orchestration");
async function recordOperatorAction(store, input) {
    const now = new Date().toISOString();
    const action = {
        id: `opact_${node_crypto_1.default.randomUUID()}`,
        kilnId: input.kilnId,
        firingRunId: input.firingRunId ?? null,
        actionType: input.actionType,
        requestedBy: input.requestedBy,
        confirmedBy: input.confirmedBy ?? null,
        requestedAt: now,
        completedAt: input.completedAt ?? now,
        checklistJson: { ...(input.checklistJson ?? {}) },
        notes: input.notes ?? null,
    };
    await store.saveOperatorAction(action);
    let event = null;
    if (action.firingRunId) {
        await (0, orchestration_1.acknowledgeFiringRunAction)(store, {
            runId: action.firingRunId,
            action,
            enableSupportedWrites: input.enableSupportedWrites,
        });
        event = {
            id: `fevt_${(0, hash_1.stableHashDeep)({ runId: action.firingRunId, actionType: action.actionType, requestedAt: action.requestedAt }).slice(0, 16)}`,
            kilnId: action.kilnId,
            firingRunId: action.firingRunId,
            ts: action.completedAt ?? action.requestedAt,
            eventType: `operator.${action.actionType}`,
            severity: action.actionType === "observed_error_code" ? "warning" : "info",
            payloadJson: {
                checklistJson: action.checklistJson,
                notes: action.notes,
                confirmedBy: action.confirmedBy,
            },
            source: "operator",
            confidence: "observed",
        };
        await store.appendFiringEvents([event]);
    }
    return { action, event };
}
