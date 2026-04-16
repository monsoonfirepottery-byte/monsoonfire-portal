import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AgentRuntimeSummary, RunLedgerEvent } from "./contracts";

const DEFAULT_RUNS_ROOT = ["output", "agent-runs"] as const;

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function agentRuntimeRunsRoot(repoRoot: string): string {
  return resolve(repoRoot, ...DEFAULT_RUNS_ROOT);
}

export function agentRuntimeRunRoot(repoRoot: string, runId: string): string {
  return resolve(agentRuntimeRunsRoot(repoRoot), clean(runId));
}

export function listAgentRuntimeSummaries(repoRoot: string, limit = 12): AgentRuntimeSummary[] {
  const runsRoot = agentRuntimeRunsRoot(repoRoot);
  if (!existsSync(runsRoot)) return [];
  const summaries = [];
  for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const summary = readJsonFile<AgentRuntimeSummary>(resolve(runsRoot, entry.name, "summary.json"));
    if (!summary) continue;
    summaries.push(summary);
  }
  return summaries
    .sort((left, right) => clean(right.updatedAt).localeCompare(clean(left.updatedAt)))
    .slice(0, Math.max(1, limit));
}

export function readLatestAgentRuntimeSummary(repoRoot: string): AgentRuntimeSummary | null {
  const pointer = readJsonFile<{ runId?: string }>(resolve(agentRuntimeRunsRoot(repoRoot), "latest.json"));
  const pointerRunId = clean(pointer?.runId);
  if (pointerRunId) {
    const summary = readJsonFile<AgentRuntimeSummary>(resolve(agentRuntimeRunRoot(repoRoot, pointerRunId), "summary.json"));
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
  const runRoot = agentRuntimeRunRoot(repoRoot, event.runId);
  mkdirSync(runRoot, { recursive: true });
  appendFileSync(resolve(runRoot, "run-ledger.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
}

export function writeAgentRuntimeSummary(repoRoot: string, summary: AgentRuntimeSummary): void {
  const runRoot = agentRuntimeRunRoot(repoRoot, summary.runId);
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(resolve(runRoot, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(
    resolve(agentRuntimeRunsRoot(repoRoot), "latest.json"),
    `${JSON.stringify({ schema: "agent-runtime-pointer.v1", runId: summary.runId, updatedAt: summary.updatedAt }, null, 2)}\n`,
    "utf8",
  );
}
