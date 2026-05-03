import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import crypto from "node:crypto";
import type { MemoryOpsAction, MemoryOpsEvent, MemoryOpsReceipt, MemoryOpsSnapshot } from "./contracts";
import { resolveControlTowerRepoRoot } from "../controlTower/collect";

export const MEMORY_OPS_RELATIVE_DIR = ["output", "studio-brain", "memory-ops"] as const;
export const MEMORY_OPS_LATEST_FILE = "latest.json";
export const MEMORY_OPS_STATE_FILE = "state.json";
export const MEMORY_OPS_EVENTS_FILE = "events.jsonl";

export function resolveMemoryOpsDir(repoRoot?: string): string {
  return resolve(resolveControlTowerRepoRoot(repoRoot), ...MEMORY_OPS_RELATIVE_DIR);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, path);
}

function isSnapshot(value: unknown): value is MemoryOpsSnapshot {
  return Boolean(value && typeof value === "object" && (value as MemoryOpsSnapshot).schema === "studio-brain.memory-ops.snapshot.v1");
}

export function readMemoryOpsSnapshot(repoRoot?: string): MemoryOpsSnapshot | null {
  const dir = resolveMemoryOpsDir(repoRoot);
  const latest = readJson<MemoryOpsSnapshot>(resolve(dir, MEMORY_OPS_LATEST_FILE));
  if (isSnapshot(latest)) return latest;
  const state = readJson<MemoryOpsSnapshot>(resolve(dir, MEMORY_OPS_STATE_FILE));
  return isSnapshot(state) ? state : null;
}

export function writeMemoryOpsSnapshot(snapshot: MemoryOpsSnapshot, repoRoot?: string): void {
  const dir = resolveMemoryOpsDir(repoRoot);
  writeJsonAtomic(resolve(dir, MEMORY_OPS_STATE_FILE), snapshot);
  writeJsonAtomic(resolve(dir, MEMORY_OPS_LATEST_FILE), snapshot);
}

export function appendMemoryOpsEvent(event: Omit<MemoryOpsEvent, "schema" | "id" | "at"> & { id?: string; at?: string }, repoRoot?: string): MemoryOpsEvent {
  const created: MemoryOpsEvent = {
    schema: "studio-brain.memory-ops.event.v1",
    id: event.id || `memory-ops-event:${crypto.randomUUID()}`,
    at: event.at || new Date().toISOString(),
    kind: event.kind,
    severity: event.severity,
    title: event.title,
    summary: event.summary,
    actionId: event.actionId ?? null,
    payload: event.payload,
  };
  const path = resolve(resolveMemoryOpsDir(repoRoot), MEMORY_OPS_EVENTS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(created)}\n`, "utf8");
  return created;
}

export function mergeMemoryOpsActions(previous: MemoryOpsSnapshot | null, nextActions: MemoryOpsAction[], nowIso: string): MemoryOpsAction[] {
  const previousById = new Map((previous?.actions ?? []).map((action) => [action.id, action]));
  return nextActions.map((action) => {
    const existing = previousById.get(action.id);
    if (!existing) return action;
    const keepStatus =
      existing.status === "approved" ||
      existing.status === "running" ||
      existing.status === "succeeded" ||
      existing.status === "failed";
    return {
      ...action,
      status: keepStatus ? existing.status : action.status,
      firstSeenAt: existing.firstSeenAt || action.firstSeenAt,
      lastSeenAt: nowIso,
      approvedAt: existing.approvedAt ?? action.approvedAt ?? null,
      approvedBy: existing.approvedBy ?? action.approvedBy ?? null,
      executedAt: existing.executedAt ?? action.executedAt ?? null,
      executionSummary: existing.executionSummary ?? action.executionSummary ?? null,
    };
  });
}

export function approveMemoryOpsAction(input: {
  repoRoot?: string;
  actionId: string;
  actor: string;
  rationale?: string;
}): { ok: true; snapshot: MemoryOpsSnapshot; action: MemoryOpsAction; receipt: MemoryOpsReceipt } | { ok: false; statusCode: number; message: string } {
  const snapshot = readMemoryOpsSnapshot(input.repoRoot);
  if (!snapshot) {
    return { ok: false, statusCode: 404, message: "Memory ops sidecar state is not available yet." };
  }
  const actionIndex = snapshot.actions.findIndex((action) => action.id === input.actionId);
  if (actionIndex < 0) {
    return { ok: false, statusCode: 404, message: "Memory ops action not found." };
  }
  const action = snapshot.actions[actionIndex];
  if (action.policy !== "approval_required") {
    return { ok: false, statusCode: 400, message: "Only approval-required memory ops actions can be approved." };
  }
  const nowIso = new Date().toISOString();
  const receipt: MemoryOpsReceipt = {
    id: `memory-ops-receipt:${crypto.createHash("sha256").update(`${action.id}:${input.actor}:approved`).digest("hex").slice(0, 24)}`,
    actionId: action.id,
    at: nowIso,
    actor: input.actor,
    status: "approved",
    summary: input.rationale?.trim() || `Approved ${action.title}.`,
    details: {
      policy: action.policy,
      executionKind: action.execution.kind,
    },
  };
  const receipts = [
    receipt,
    ...snapshot.receipts.filter((entry) => !(entry.actionId === action.id && entry.status === "approved" && entry.actor === input.actor)),
  ].slice(0, 80);
  const nextAction: MemoryOpsAction = {
    ...action,
    status: "approved",
    approvedAt: nowIso,
    approvedBy: input.actor,
  };
  const nextSnapshot: MemoryOpsSnapshot = {
    ...snapshot,
    generatedAt: nowIso,
    actions: snapshot.actions.map((entry, index) => (index === actionIndex ? nextAction : entry)),
    receipts,
  };
  writeMemoryOpsSnapshot(nextSnapshot, input.repoRoot);
  appendMemoryOpsEvent(
    {
      kind: "receipt",
      severity: "warning",
      title: "Memory ops action approved",
      summary: receipt.summary,
      actionId: action.id,
      payload: receipt.details,
    },
    input.repoRoot,
  );
  return { ok: true, snapshot: nextSnapshot, action: nextAction, receipt };
}
