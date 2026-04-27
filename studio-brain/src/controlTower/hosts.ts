import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { ControlTowerHostCard, ControlTowerHostConnectivity, ControlTowerHostHealth } from "./types";

const DEFAULT_HOSTS_ROOT = ["output", "ops-cockpit", "hosts"] as const;
const SAFE_CONTROL_TOWER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export type ControlTowerHostHeartbeat = {
  schema: "control-tower-host-heartbeat.v1";
  hostId: string;
  label: string;
  environment: "local" | "server";
  role: string;
  health: ControlTowerHostHealth;
  lastSeenAt: string;
  currentRunId?: string | null;
  agentCount?: number;
  version?: string | null;
  metadata?: Record<string, unknown>;
  metrics?: {
    cpuPct?: number | null;
    memoryPct?: number | null;
    load1?: number | null;
  };
};

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hostRoots(repoRoot: string): string {
  return resolve(repoRoot, ...DEFAULT_HOSTS_ROOT);
}

export function isSafeControlTowerHostId(value: unknown): boolean {
  const normalized = clean(value);
  return SAFE_CONTROL_TOWER_ID.test(normalized) && normalized !== "." && normalized !== "..";
}

export function normalizeControlTowerHostId(value: unknown, fieldName = "hostId"): string {
  const normalized = clean(value);
  if (!isSafeControlTowerHostId(normalized)) {
    throw new Error(`${fieldName} must be a safe identifier using only letters, numbers, dot, underscore, or hyphen.`);
  }
  return normalized;
}

function normalizeReferencedRunId(value: unknown): string | null {
  const normalized = clean(value);
  if (!normalized) return null;
  if (!SAFE_CONTROL_TOWER_ID.test(normalized) || normalized === "." || normalized === "..") {
    throw new Error("currentRunId must be a safe identifier using only letters, numbers, dot, underscore, or hyphen.");
  }
  return normalized;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, rawValue] of Object.entries(value as Record<string, unknown>).slice(0, 32)) {
    const normalizedKey = clean(key);
    if (!normalizedKey || rawValue === undefined) continue;
    output[normalizedKey] = rawValue;
  }
  return output;
}

function resolveContainedPath(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments);
  const rel = relative(root, target);
  if (rel && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new Error("Resolved host heartbeat path escaped the hosts root.");
  }
  return target;
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

function minutesSince(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor((nowMs - parsed) / 60_000));
}

function deriveConnectivity(ageMinutes: number | null): ControlTowerHostConnectivity {
  if (ageMinutes === null) return "offline";
  if (ageMinutes <= 2) return "online";
  if (ageMinutes <= 10) return "stale";
  return "offline";
}

function summaryForHeartbeat(heartbeat: ControlTowerHostHeartbeat, connectivity: ControlTowerHostConnectivity): string {
  const runLabel = clean(heartbeat.currentRunId);
  const agentCount = Math.max(0, Number(heartbeat.agentCount ?? 0));
  const metadata = normalizeMetadata(heartbeat.metadata);
  const activeCommand = clean(metadata.activeCommand);
  const verificationLane = clean(metadata.verificationLane);
  const presence =
    connectivity === "online"
      ? "fresh heartbeat"
      : connectivity === "stale"
        ? "heartbeat stale"
        : "heartbeat offline";
  const runSummary = runLabel ? `run ${runLabel}` : "no active run";
  const activitySummary = activeCommand || verificationLane;
  return `${presence} · ${runSummary} · ${agentCount} agent${agentCount === 1 ? "" : "s"}${activitySummary ? ` · ${activitySummary}` : ""}`;
}

export function writeControlTowerHostHeartbeat(repoRoot: string, heartbeat: ControlTowerHostHeartbeat): void {
  mkdirSync(hostRoots(repoRoot), { recursive: true });
  const hostId = normalizeControlTowerHostId(heartbeat.hostId);
  const normalized: ControlTowerHostHeartbeat = {
    schema: "control-tower-host-heartbeat.v1",
    hostId,
    label: clean(heartbeat.label) || hostId,
    environment: heartbeat.environment === "server" ? "server" : "local",
    role: clean(heartbeat.role) || "operator-host",
    health: heartbeat.health,
    lastSeenAt: clean(heartbeat.lastSeenAt) || new Date().toISOString(),
    currentRunId: normalizeReferencedRunId(heartbeat.currentRunId),
    agentCount: Math.max(0, Number(heartbeat.agentCount ?? 0)),
    version: clean(heartbeat.version) || null,
    metadata: normalizeMetadata(heartbeat.metadata),
    metrics: {
      cpuPct: Number.isFinite(Number(heartbeat.metrics?.cpuPct)) ? Number(heartbeat.metrics?.cpuPct) : null,
      memoryPct: Number.isFinite(Number(heartbeat.metrics?.memoryPct)) ? Number(heartbeat.metrics?.memoryPct) : null,
      load1: Number.isFinite(Number(heartbeat.metrics?.load1)) ? Number(heartbeat.metrics?.load1) : null,
    },
  };
  writeFileSync(
    resolveContainedPath(hostRoots(repoRoot), `${normalized.hostId}.json`),
    `${JSON.stringify(normalized, null, 2)}\n`,
    "utf8",
  );
}

export function listControlTowerHostHeartbeats(repoRoot: string, nowMs = Date.now()): ControlTowerHostCard[] {
  const root = hostRoots(repoRoot);
  if (!existsSync(root)) return [];
  const hosts: ControlTowerHostCard[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (!isSafeControlTowerHostId(entry.name.slice(0, -5))) continue;
    const heartbeat = readJsonFile<ControlTowerHostHeartbeat>(resolve(root, entry.name));
    if (!heartbeat || !isSafeControlTowerHostId(heartbeat.hostId)) continue;
    const ageMinutes = minutesSince(heartbeat.lastSeenAt, nowMs);
    const connectivity = deriveConnectivity(ageMinutes);
    hosts.push({
      hostId: heartbeat.hostId,
      label: heartbeat.label || heartbeat.hostId,
      environment: heartbeat.environment,
      role: heartbeat.role,
      connectivity,
      health: connectivity === "offline" && heartbeat.health !== "maintenance" ? "offline" : heartbeat.health,
      lastSeenAt: heartbeat.lastSeenAt,
      ageMinutes,
      currentRunId: clean(heartbeat.currentRunId) || null,
      agentCount: Math.max(0, Number(heartbeat.agentCount ?? 0)),
      version: clean(heartbeat.version) || null,
      metadata: normalizeMetadata(heartbeat.metadata),
      summary: summaryForHeartbeat(heartbeat, connectivity),
      metrics: {
        cpuPct: Number.isFinite(Number(heartbeat.metrics?.cpuPct)) ? Number(heartbeat.metrics?.cpuPct) : null,
        memoryPct: Number.isFinite(Number(heartbeat.metrics?.memoryPct)) ? Number(heartbeat.metrics?.memoryPct) : null,
        load1: Number.isFinite(Number(heartbeat.metrics?.load1)) ? Number(heartbeat.metrics?.load1) : null,
      },
    });
  }
  return hosts.sort((left, right) => String(right.lastSeenAt || "").localeCompare(String(left.lastSeenAt || "")));
}
