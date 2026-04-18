import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { ControlTowerHostCard, ControlTowerHostConnectivity, ControlTowerHostHealth } from "./types";

const DEFAULT_HOSTS_ROOT = ["output", "ops-cockpit", "hosts"] as const;

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
  const presence =
    connectivity === "online"
      ? "fresh heartbeat"
      : connectivity === "stale"
        ? "heartbeat stale"
        : "heartbeat offline";
  const runSummary = runLabel ? `run ${runLabel}` : "no active run";
  return `${presence} · ${runSummary} · ${agentCount} agent${agentCount === 1 ? "" : "s"}`;
}

export function writeControlTowerHostHeartbeat(repoRoot: string, heartbeat: ControlTowerHostHeartbeat): void {
  mkdirSync(hostRoots(repoRoot), { recursive: true });
  const normalized: ControlTowerHostHeartbeat = {
    schema: "control-tower-host-heartbeat.v1",
    hostId: clean(heartbeat.hostId),
    label: clean(heartbeat.label) || clean(heartbeat.hostId),
    environment: heartbeat.environment === "server" ? "server" : "local",
    role: clean(heartbeat.role) || "operator-host",
    health: heartbeat.health,
    lastSeenAt: clean(heartbeat.lastSeenAt) || new Date().toISOString(),
    currentRunId: clean(heartbeat.currentRunId) || null,
    agentCount: Math.max(0, Number(heartbeat.agentCount ?? 0)),
    version: clean(heartbeat.version) || null,
    metrics: {
      cpuPct: Number.isFinite(Number(heartbeat.metrics?.cpuPct)) ? Number(heartbeat.metrics?.cpuPct) : null,
      memoryPct: Number.isFinite(Number(heartbeat.metrics?.memoryPct)) ? Number(heartbeat.metrics?.memoryPct) : null,
      load1: Number.isFinite(Number(heartbeat.metrics?.load1)) ? Number(heartbeat.metrics?.load1) : null,
    },
  };
  writeFileSync(
    resolve(hostRoots(repoRoot), `${normalized.hostId}.json`),
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
    const heartbeat = readJsonFile<ControlTowerHostHeartbeat>(resolve(root, entry.name));
    if (!heartbeat || !clean(heartbeat.hostId)) continue;
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
