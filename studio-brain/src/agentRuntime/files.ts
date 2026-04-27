import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";

import type { AgentRuntimeArtifact, AgentRuntimeSummary, RunLedgerEvent } from "./contracts";

const DEFAULT_RUNS_ROOT = ["output", "agent-runs"] as const;
const SAFE_AGENT_RUNTIME_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function isSafeAgentRuntimeId(value: unknown): boolean {
  const normalized = clean(value);
  return SAFE_AGENT_RUNTIME_ID.test(normalized) && normalized !== "." && normalized !== "..";
}

export function normalizeAgentRuntimeRunId(value: unknown, fieldName = "runId"): string {
  const normalized = clean(value);
  if (!isSafeAgentRuntimeId(normalized)) {
    throw new Error(`${fieldName} must be a safe identifier using only letters, numbers, dot, underscore, or hyphen.`);
  }
  return normalized;
}

function resolveContainedPath(root: string, ...segments: string[]): string {
  const target = resolve(root, ...segments);
  const rel = relative(root, target);
  if (rel && (rel.startsWith("..") || isAbsolute(rel))) {
    throw new Error("Resolved runtime path escaped the agent runs root.");
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

function isPreviewableArtifact(path: string): boolean {
  const extension = extname(path).toLowerCase();
  return [".json", ".jsonl", ".log", ".md", ".txt", ".yaml", ".yml"].includes(extension);
}

function artifactKind(path: string): AgentRuntimeArtifact["kind"] {
  const extension = extname(path).toLowerCase();
  if (extension === ".json") return "json";
  if (extension === ".jsonl" || extension === ".log") return "ledger";
  if ([".md", ".txt", ".yaml", ".yml"].includes(extension)) return "text";
  return "file";
}

export function agentRuntimeRunsRoot(repoRoot: string): string {
  return resolve(repoRoot, ...DEFAULT_RUNS_ROOT);
}

export function agentRuntimeRunRoot(repoRoot: string, runId: string): string {
  const runsRoot = agentRuntimeRunsRoot(repoRoot);
  return resolveContainedPath(runsRoot, normalizeAgentRuntimeRunId(runId));
}

export function listAgentRuntimeSummaries(repoRoot: string, limit = 12): AgentRuntimeSummary[] {
  const runsRoot = agentRuntimeRunsRoot(repoRoot);
  if (!existsSync(runsRoot)) return [];
  const summaries = [];
  for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!isSafeAgentRuntimeId(entry.name)) continue;
    const summary = readJsonFile<AgentRuntimeSummary>(resolve(runsRoot, entry.name, "summary.json"));
    if (!summary) continue;
    summaries.push(summary);
  }
  return summaries
    .sort((left, right) => clean(right.updatedAt).localeCompare(clean(left.updatedAt)))
    .slice(0, Math.max(1, limit));
}

export function readAgentRuntimeSummary(repoRoot: string, runId: string): AgentRuntimeSummary | null {
  return readJsonFile<AgentRuntimeSummary>(resolve(agentRuntimeRunRoot(repoRoot, runId), "summary.json"));
}

export function readLatestAgentRuntimeSummary(repoRoot: string): AgentRuntimeSummary | null {
  const pointer = readJsonFile<{ runId?: string }>(resolve(agentRuntimeRunsRoot(repoRoot), "latest.json"));
  const pointerRunId = clean(pointer?.runId);
  if (pointerRunId) {
    const summary = readAgentRuntimeSummary(repoRoot, pointerRunId);
    if (summary) return summary;
  }
  return listAgentRuntimeSummaries(repoRoot, 1)[0] ?? null;
}

export function readAgentRuntimeEvents(repoRoot: string, runId: string, limit = 50): RunLedgerEvent[] {
  const ledgerPath = resolve(agentRuntimeRunRoot(repoRoot, runId), "run-ledger.jsonl");
  if (!existsSync(ledgerPath)) return [];
  const events = [];
  for (const line of readFileSync(ledgerPath, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      continue;
    }
  }
  return events.slice(-Math.max(1, limit));
}

export function appendAgentRuntimeEvent(repoRoot: string, event: RunLedgerEvent): void {
  const runId = normalizeAgentRuntimeRunId(event.runId);
  const runRoot = agentRuntimeRunRoot(repoRoot, runId);
  mkdirSync(runRoot, { recursive: true });
  appendFileSync(resolve(runRoot, "run-ledger.jsonl"), `${JSON.stringify({ ...event, runId })}\n`, "utf8");
}

export function writeAgentRuntimeSummary(repoRoot: string, summary: AgentRuntimeSummary): void {
  const runId = normalizeAgentRuntimeRunId(summary.runId);
  const normalized = { ...summary, runId };
  const runRoot = agentRuntimeRunRoot(repoRoot, runId);
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(resolve(runRoot, "summary.json"), `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  writeFileSync(
    resolve(agentRuntimeRunsRoot(repoRoot), "latest.json"),
    `${JSON.stringify({ schema: "agent-runtime-pointer.v1", runId, updatedAt: summary.updatedAt }, null, 2)}\n`,
    "utf8",
  );
}

export function listAgentRuntimeArtifacts(repoRoot: string, runId: string, limit = 18): AgentRuntimeArtifact[] {
  const runRoot = agentRuntimeRunRoot(repoRoot, runId);
  if (!existsSync(runRoot)) return [];
  const queue = [runRoot];
  const artifacts: AgentRuntimeArtifact[] = [];

  while (queue.length && artifacts.length < Math.max(1, limit)) {
    const current = queue.shift() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (artifacts.length >= Math.max(1, limit)) break;
      const absolutePath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        if (relative(runRoot, absolutePath).split(/[\\/]/).length <= 2) {
          queue.push(absolutePath);
        }
        continue;
      }
      if (!entry.isFile()) continue;
      const stats = statSync(absolutePath);
      const preview =
        isPreviewableArtifact(absolutePath) && stats.size <= 128_000
          ? readFileSync(absolutePath, "utf8").slice(0, 1_200)
          : null;
      artifacts.push({
        artifactId: relative(runRoot, absolutePath).replaceAll("\\", "/"),
        runId,
        label: entry.name,
        kind: artifactKind(absolutePath),
        path: relative(repoRoot, absolutePath).replaceAll("\\", "/"),
        sizeBytes: stats.size,
        updatedAt: Number.isFinite(stats.mtimeMs) ? new Date(stats.mtimeMs).toISOString() : null,
        preview,
      });
    }
  }

  return artifacts.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}
