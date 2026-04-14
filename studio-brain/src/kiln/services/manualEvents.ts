import crypto from "node:crypto";
import { stableHashDeep } from "../../stores/hash";
import type { FiringEvent, OperatorAction } from "../domain/model";
import type { KilnStore } from "../store";
import { acknowledgeFiringRunAction } from "./orchestration";

export type RecordOperatorActionInput = {
  kilnId: string;
  firingRunId?: string | null;
  actionType: string;
  requestedBy: string;
  confirmedBy?: string | null;
  checklistJson?: Record<string, unknown>;
  notes?: string | null;
  completedAt?: string | null;
  enableSupportedWrites: boolean;
};

export async function recordOperatorAction(
  store: KilnStore,
  input: RecordOperatorActionInput,
): Promise<{ action: OperatorAction; event: FiringEvent | null }> {
  const now = new Date().toISOString();
  const action: OperatorAction = {
    id: `opact_${crypto.randomUUID()}`,
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

  let event: FiringEvent | null = null;
  if (action.firingRunId) {
    await acknowledgeFiringRunAction(store, {
      runId: action.firingRunId,
      action,
      enableSupportedWrites: input.enableSupportedWrites,
    });
    event = {
      id: `fevt_${stableHashDeep({ runId: action.firingRunId, actionType: action.actionType, requestedAt: action.requestedAt }).slice(0, 16)}`,
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
