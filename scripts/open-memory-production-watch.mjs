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
      "Open Memory production wave watcher",
      "",
      "Usage:",
      "  node ./scripts/open-memory-production-watch.mjs --status ./output/memory/<wave>/wave-status.json",
      "",
      "Options:",
      "  --status <path>       Required status JSON path",
      "  --events <path>       Optional events JSONL path",
      "  --refresh-ms <n>      Refresh cadence (default: 2000)",
      "  --once                Print once and exit",
    ].join("\n")
  );
}

function safeReadJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function recentEvents(path, limit = 8) {
  if (!path || !existsSync(path)) return [];
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
}

function render(status, events) {
  const lines = [];
  lines.push(`Wave: ${status?.waveId || "unknown"}`);
  lines.push(`State: ${status?.state || "unknown"}`);
  lines.push(`Current: ${(status?.currentVector || "idle")} / ${(status?.currentStage || "idle")}`);
  lines.push(`Started: ${status?.startedAt || "unknown"}`);
  lines.push(`Updated: ${status?.updatedAt || "unknown"}`);
  if (status?.postRunReview) {
    lines.push(`Post-run review: ${status.postRunReview.status || "pending"}${status.postRunReview.flaggedFindings ? ` flagged=${status.postRunReview.flaggedFindings}` : ""}`);
  }
  lines.push("");
  lines.push("Vectors:");
  for (const [name, vector] of Object.entries(status?.vectors || {})) {
    const counts = Object.entries(vector?.counts || {})
      .filter(([, value]) => Number.isFinite(value))
      .slice(0, 4)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    lines.push(`- ${name}: ${vector?.status || "pending"}${vector?.currentStage ? ` (${vector.currentStage})` : ""}${counts ? ` ${counts}` : ""}`);
  }
  if (events.length > 0) {
    lines.push("");
    lines.push("Recent events:");
    for (const event of events) {
      lines.push(`- ${event.generatedAt || ""} ${event.type || "event"} ${event.vector ? `[${event.vector}]` : ""} ${event.stage || ""}`.trim());
    }
  }
  return lines.join("\n");
}

function main() {
  const { flags } = parseCliArgs(process.argv.slice(2));
  if (readBoolFlag(flags, "help", false) || readBoolFlag(flags, "h", false)) {
    usage();
    return;
  }
  const statusFlag = readStringFlag(flags, "status", "").trim();
  if (!statusFlag) throw new Error("--status is required");
  const statusPath = resolve(REPO_ROOT, statusFlag);
  const eventsFlag = readStringFlag(flags, "events", "").trim();
  const eventsPath = eventsFlag ? resolve(REPO_ROOT, eventsFlag) : "";
  const refreshMs = readNumberFlag(flags, "refresh-ms", 2000, { min: 250, max: 60000 });
  const once = readBoolFlag(flags, "once", false);

  const paint = () => {
    const status = safeReadJson(statusPath) || {};
    const events = recentEvents(eventsPath);
    process.stdout.write("\u001bc");
    process.stdout.write(`${render(status, events)}\n`);
    if (once || ["completed", "failed", "interrupted"].includes(String(status.state || ""))) {
      process.exit(0);
    }
  };

  paint();
  if (!once) {
    setInterval(paint, refreshMs);
  }
}

main();
