#!/usr/bin/env node

import { resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildAgentSelectableToolRegistry,
  buildContextPack,
  buildMissionEnvelope,
  loadToolContractRegistry,
  writeAgentRunBundle,
} from "./lib/agent-harness-control-plane.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    json: false,
    write: false,
    runId: "",
    missionId: "",
    title: "",
    riskLane: "",
    intentIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] ?? "").trim();
    if (!arg) continue;
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--write") {
      parsed.write = true;
      continue;
    }
    if ((arg === "--intent" || arg === "--intent-id") && argv[index + 1]) {
      parsed.intentIds.push(String(argv[index + 1]).trim());
      index += 1;
      continue;
    }
    if (arg.startsWith("--intent=")) {
      parsed.intentIds.push(arg.slice("--intent=".length).trim());
      continue;
    }
    if (arg === "--run-id" && argv[index + 1]) {
      parsed.runId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      parsed.runId = arg.slice("--run-id=".length).trim();
      continue;
    }
    if (arg === "--mission-id" && argv[index + 1]) {
      parsed.missionId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--mission-id=")) {
      parsed.missionId = arg.slice("--mission-id=".length).trim();
      continue;
    }
    if (arg === "--title" && argv[index + 1]) {
      parsed.title = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--title=")) {
      parsed.title = arg.slice("--title=".length).trim();
      continue;
    }
    if (arg === "--risk-lane" && argv[index + 1]) {
      parsed.riskLane = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--risk-lane=")) {
      parsed.riskLane = arg.slice("--risk-lane=".length).trim();
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Agent harness prepare",
          "",
          "Usage:",
          "  node ./scripts/agent-harness-prepare.mjs [--json] [--write] [--intent <intentId>]",
          "",
          "Options:",
          "  --intent <id>       Limit the mission to one or more intent IDs",
          "  --run-id <id>       Override the generated run id",
          "  --mission-id <id>   Override the generated mission id",
          "  --title <title>     Override the mission title",
          "  --risk-lane <lane>  interactive | background | high_risk",
          "  --write             Persist mission/context/contracts under output/agent-runs/<run-id>",
          "  --json              Emit the prepared bundle summary as JSON",
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return parsed;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const fullToolRegistry = loadToolContractRegistry(REPO_ROOT).registry;
  const toolRegistry = buildAgentSelectableToolRegistry(fullToolRegistry);
  const missionEnvelope = buildMissionEnvelope(REPO_ROOT, {
    runId: args.runId,
    missionId: args.missionId,
    title: args.title,
    riskLane: args.riskLane,
    intentIds: args.intentIds,
  });
  const contextPack = buildContextPack(REPO_ROOT, { runId: missionEnvelope.runId });

  const report = {
    schema: "agent-harness-prepare-report.v1",
    generatedAt: missionEnvelope.generatedAt,
    runId: missionEnvelope.runId,
    missionId: missionEnvelope.missionId,
    riskLane: missionEnvelope.riskLane,
    missionTitle: missionEnvelope.missionTitle,
    selectedIntentIds: missionEnvelope.selectedIntents.map((intent) => intent.intentId),
    taskCount: missionEnvelope.taskRefs.length,
    groundingSources: contextPack.groundingSources,
    activeBlockers: contextPack.telemetry.startupBlockers,
    toolContracts: {
      full: Array.isArray(fullToolRegistry.tools) ? fullToolRegistry.tools.length : 0,
      selectable: Array.isArray(toolRegistry.tools) ? toolRegistry.tools.length : 0,
    },
  };

  let written = null;
  if (args.write) {
    written = writeAgentRunBundle(REPO_ROOT, {
      missionEnvelope,
      contextPack,
      toolRegistry,
    });
  }

  if (args.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          report: {
            ...report,
            written: written
              ? {
                  runRoot: written.runRoot,
                  summaryPath: written.summaryPath,
                  pointerPath: written.pointerPath,
                }
              : null,
          },
          bundle: {
            missionEnvelope,
            contextPack,
            toolRegistry,
          },
        },
        null,
        2,
      )}\n`
    );
    return;
  }

  process.stdout.write(`agent-harness prepare: ${report.runId}\n`);
  process.stdout.write(`mission: ${report.missionTitle}\n`);
  process.stdout.write(`risk lane: ${report.riskLane}\n`);
  process.stdout.write(`intents: ${report.selectedIntentIds.join(", ")}\n`);
  process.stdout.write(`grounding: ${report.groundingSources.join(", ")}\n`);
  if (written) {
    process.stdout.write(`run root: ${written.runRoot}\n`);
  }
}

main();
