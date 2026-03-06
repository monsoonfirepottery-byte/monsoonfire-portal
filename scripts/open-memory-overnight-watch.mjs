#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs, readBoolFlag, readNumberFlag, readStringFlag } from "./lib/pst-memory-utils.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function usage() {
  process.stdout.write(
    [
      "Open Memory overnight watcher",
      "",
      "Usage:",
      "  node ./scripts/open-memory-overnight-watch.mjs \\",
      "    --status ./output/memory/overnight-iterate-foo/overnight-status.json \\",
      "    --events ./output/memory/overnight-iterate-foo/overnight-events.jsonl",
      "",
      "Options:",
      "  --status <path>       Status JSON path",
      "  --events <path>       Events JSONL path",
      "  --refresh-ms <n>      Refresh cadence (default: 2000)",
      "  --once                Render once and exit",
    ].join("\n")
  );
}

function readJson(path) {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readEvents(path, limit = 8) {
  try {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, "utf8").trim();
    if (!raw) return [];
    return raw
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function render(status, events) {
  const lines = [];
  lines.push(`Run: ${status?.runId || "unknown"}`);
  lines.push(`State: ${status?.state || "unknown"}`);
  lines.push(`Phase: ${status?.currentPhase || "idle"}`);
  lines.push(`Updated: ${status?.updatedAt || "unknown"}`);
  if (status?.summary) {
    lines.push(
      `Summary: sampled=${status.summary.sampledMailRuns || 0} iterations=${status.summary.candidateIterations || 0} passing=${status.summary.passingCandidates || 0} bestDelta=${status.summary.bestScoreDelta || 0} soak=${status.summary.soakCompleted || 0}`
    );
  }
  if (Array.isArray(status?.candidates) && status.candidates.length > 0) {
    lines.push("Candidates:");
    for (const candidate of status.candidates.slice(-5)) {
      lines.push(`  - ${candidate.id}: pass=${candidate.pass} delta=${candidate.scoreDelta} warnings=${(candidate.warnings || []).length}`);
    }
  }
  if (events.length > 0) {
    lines.push("Recent events:");
    for (const event of events) {
      lines.push(`  - ${event.generatedAt || ""} ${event.type || "event"} ${event.phase || event.state || ""}`.trim());
    }
  }
  return `${lines.join("\n")}\n`;
}

function clearScreen() {
  process.stdout.write("\u001bc");
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }
  const statusPath = resolve(REPO_ROOT, readStringFlag(flags, "status", ""));
  const eventsPath = resolve(REPO_ROOT, readStringFlag(flags, "events", ""));
  if (!statusPath || !eventsPath) throw new Error("--status and --events are required");
  const refreshMs = readNumberFlag(flags, "refresh-ms", 2000, { min: 250, max: 60000 });
  const once = readBoolFlag(flags, "once", false);

  const paint = () => {
    const status = readJson(statusPath);
    const events = readEvents(eventsPath);
    clearScreen();
    process.stdout.write(render(status, events));
  };

  paint();
  if (once) return;
  setInterval(paint, refreshMs);
}

try {
  main();
} catch (error) {
  process.stderr.write(`open-memory-overnight-watch failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
