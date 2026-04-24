import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { PartnerBrief, PartnerCheckinRecord, PartnerOpenLoop } from "./contracts";

const PARTNER_ROOT = ["output", "studio-brain", "partner"] as const;
const LATEST_BRIEF_FILE = "latest-brief.json";
const CHECKINS_FILE = "checkins.jsonl";
const OPEN_LOOPS_FILE = "open-loops.json";

function readJsonFile<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

export function partnerRoot(repoRoot: string): string {
  return resolve(repoRoot, ...PARTNER_ROOT);
}

export function partnerLatestBriefPath(repoRoot: string): string {
  return resolve(partnerRoot(repoRoot), LATEST_BRIEF_FILE);
}

export function partnerCheckinsPath(repoRoot: string): string {
  return resolve(partnerRoot(repoRoot), CHECKINS_FILE);
}

export function partnerOpenLoopsPath(repoRoot: string): string {
  return resolve(partnerRoot(repoRoot), OPEN_LOOPS_FILE);
}

export function partnerArtifactPaths(): {
  latestBriefPath: string;
  checkinsPath: string;
  openLoopsPath: string;
} {
  return {
    latestBriefPath: [...PARTNER_ROOT, LATEST_BRIEF_FILE].join("/"),
    checkinsPath: [...PARTNER_ROOT, CHECKINS_FILE].join("/"),
    openLoopsPath: [...PARTNER_ROOT, OPEN_LOOPS_FILE].join("/"),
  };
}

export function readLatestPartnerBrief(repoRoot: string): PartnerBrief | null {
  return readJsonFile<PartnerBrief>(partnerLatestBriefPath(repoRoot));
}

export function writeLatestPartnerBrief(repoRoot: string, brief: PartnerBrief): void {
  mkdirSync(partnerRoot(repoRoot), { recursive: true });
  writeFileSync(partnerLatestBriefPath(repoRoot), `${JSON.stringify(brief, null, 2)}\n`, "utf8");
}

export function readPartnerOpenLoops(repoRoot: string): PartnerOpenLoop[] {
  const payload = readJsonFile<{ schema?: string; updatedAt?: string; rows?: PartnerOpenLoop[] }>(partnerOpenLoopsPath(repoRoot));
  return Array.isArray(payload?.rows) ? payload.rows : [];
}

export function writePartnerOpenLoops(repoRoot: string, rows: PartnerOpenLoop[], updatedAt: string): void {
  mkdirSync(partnerRoot(repoRoot), { recursive: true });
  writeFileSync(
    partnerOpenLoopsPath(repoRoot),
    `${JSON.stringify({ schema: "studio-brain.partner-open-loops.v1", updatedAt, rows }, null, 2)}\n`,
    "utf8",
  );
}

export function appendPartnerCheckin(repoRoot: string, record: PartnerCheckinRecord): void {
  mkdirSync(partnerRoot(repoRoot), { recursive: true });
  appendFileSync(partnerCheckinsPath(repoRoot), `${JSON.stringify(record)}\n`, "utf8");
}

export function readPartnerCheckins(repoRoot: string, limit = 40): PartnerCheckinRecord[] {
  const target = partnerCheckinsPath(repoRoot);
  if (!existsSync(target)) return [];
  const rows: PartnerCheckinRecord[] = [];
  for (const line of readFileSync(target, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      rows.push(JSON.parse(line) as PartnerCheckinRecord);
    } catch {
      continue;
    }
  }
  return rows.slice(-Math.max(1, limit));
}
