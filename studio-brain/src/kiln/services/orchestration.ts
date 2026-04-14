import crypto from "node:crypto";
import { deriveKilnControlPosture } from "../domain/fingerprint";
import type { FiringRun, FiringRunStatus, LinkedPortalRefs, OperatorAction } from "../domain/model";
import type { KilnStore } from "../store";

function emptyPortalRefs(): LinkedPortalRefs {
  return {
    batchIds: [],
    pieceIds: [],
    reservationIds: [],
    portalFiringId: null,
  };
}

export type CreateFiringRunInput = {
  kilnId: string;
  requestedBy: string;
  programName?: string | null;
  programType?: string | null;
  coneTarget?: string | null;
  speed?: string | null;
  firmwareVersion?: string | null;
  queueState?: FiringRun["queueState"];
  linkedPortalRefs?: Partial<LinkedPortalRefs>;
};

export function hasStartPrerequisites(actions: OperatorAction[], checklistJson?: Record<string, unknown>): boolean {
  const completedTypes = new Set(
    actions.filter((entry) => entry.completedAt).map((entry) => String(entry.actionType).trim().toLowerCase()),
  );
  const checklist = checklistJson ?? {};
  const checklistLoaded = checklist.loaded_kiln === true || checklist.loadedKiln === true;
  const checklistClearance = checklist.verified_clearance === true || checklist.verifiedClearance === true;
  return (completedTypes.has("loaded_kiln") || checklistLoaded) && (completedTypes.has("verified_clearance") || checklistClearance);
}

export async function createFiringRun(store: KilnStore, input: CreateFiringRunInput): Promise<FiringRun> {
  const run: FiringRun = {
    id: `frun_${crypto.randomUUID()}`,
    kilnId: input.kilnId,
    runSource: "manual_controller",
    status: "queued",
    queueState: input.queueState ?? (input.programName || input.programType ? "ready_for_program" : "intake"),
    controlPosture: "Observed only",
    programName: input.programName ?? null,
    programType: input.programType ?? null,
    coneTarget: input.coneTarget ?? null,
    speed: input.speed ?? null,
    startTime: null,
    endTime: null,
    durationSec: null,
    currentSegment: null,
    totalSegments: null,
    maxTemp: null,
    finalSetPoint: null,
    operatorId: null,
    operatorConfirmationAt: null,
    firmwareVersion: input.firmwareVersion ?? null,
    rawArtifactRefs: [],
    linkedPortalRefs: {
      ...emptyPortalRefs(),
      ...input.linkedPortalRefs,
      batchIds: [...(input.linkedPortalRefs?.batchIds ?? [])],
      pieceIds: [...(input.linkedPortalRefs?.pieceIds ?? [])],
      reservationIds: [...(input.linkedPortalRefs?.reservationIds ?? [])],
      portalFiringId: input.linkedPortalRefs?.portalFiringId ?? null,
    },
  };
  await store.saveFiringRun(run);
  return run;
}

export async function acknowledgeFiringRunAction(
  store: KilnStore,
  input: {
    runId: string;
    action: OperatorAction;
    enableSupportedWrites: boolean;
  },
): Promise<FiringRun> {
  const run = await store.getFiringRun(input.runId);
  if (!run) {
    throw new Error("Firing run not found.");
  }
  const capabilityDocument = await store.getLatestCapabilityDocument(run.kilnId);
  const existingActions = await store.listOperatorActions({ firingRunId: run.id, limit: 50 });

  if (input.action.actionType === "pressed_start" && !hasStartPrerequisites(existingActions, input.action.checklistJson)) {
    throw new Error("Cannot acknowledge start before loaded_kiln and verified_clearance are completed.");
  }

  const nextRun: FiringRun = { ...run };
  switch (input.action.actionType) {
    case "pressed_start":
      nextRun.status = "firing";
      nextRun.queueState = "firing";
      nextRun.startTime = nextRun.startTime ?? input.action.completedAt ?? input.action.requestedAt;
      nextRun.operatorId = input.action.confirmedBy ?? input.action.requestedBy;
      nextRun.operatorConfirmationAt = input.action.completedAt ?? input.action.requestedAt;
      break;
    case "opened_kiln":
      nextRun.queueState = "ready_for_unload";
      break;
    case "completed_unload":
      nextRun.queueState = "complete";
      if (nextRun.status === "cooling") {
        nextRun.status = "complete";
      }
      nextRun.endTime = nextRun.endTime ?? input.action.completedAt ?? input.action.requestedAt;
      break;
    case "observed_error_code":
      nextRun.status = "error";
      nextRun.queueState = "exception";
      break;
    default:
      break;
  }
  nextRun.controlPosture = deriveKilnControlPosture({
    capabilityDocument,
    operatorConfirmationAt: nextRun.operatorConfirmationAt,
    enableSupportedWrites: input.enableSupportedWrites,
  });
  if (nextRun.startTime && nextRun.endTime) {
    const startMs = Date.parse(nextRun.startTime);
    const endMs = Date.parse(nextRun.endTime);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      nextRun.durationSec = Math.round((endMs - startMs) / 1000);
    }
  }
  await store.saveFiringRun(nextRun);
  return nextRun;
}

export function applyObservedRunState(
  run: FiringRun,
  input: {
    observedStatus?: FiringRunStatus | null;
    currentSegment?: number | null;
    totalSegments?: number | null;
    finalSetPoint?: number | null;
    maxTemp?: number | null;
    startTime?: string | null;
    endTime?: string | null;
  },
): FiringRun {
  const nextRun: FiringRun = {
    ...run,
    currentSegment: input.currentSegment ?? run.currentSegment,
    totalSegments: input.totalSegments ?? run.totalSegments,
    finalSetPoint: input.finalSetPoint ?? run.finalSetPoint,
    maxTemp: input.maxTemp ?? run.maxTemp,
    startTime: input.startTime ?? run.startTime,
    endTime: input.endTime ?? run.endTime,
  };
  switch (input.observedStatus) {
    case "firing":
      nextRun.status = "firing";
      nextRun.queueState = "firing";
      break;
    case "cooling":
      nextRun.status = "cooling";
      nextRun.queueState = "cooling";
      break;
    case "complete":
      nextRun.status = "complete";
      nextRun.queueState = "ready_for_unload";
      break;
    case "error":
      nextRun.status = "error";
      nextRun.queueState = "exception";
      break;
    case "aborted":
      nextRun.status = "aborted";
      nextRun.queueState = "exception";
      break;
    default:
      break;
  }
  if (nextRun.startTime && nextRun.endTime) {
    const startMs = Date.parse(nextRun.startTime);
    const endMs = Date.parse(nextRun.endTime);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs) {
      nextRun.durationSec = Math.round((endMs - startMs) / 1000);
    }
  }
  return nextRun;
}
