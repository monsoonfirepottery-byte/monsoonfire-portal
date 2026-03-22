#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeHandoffArtifact } from "./lib/codex-session-memory-utils.mjs";
import { buildIntentProcHandoff } from "./lib/intent-codex-proc-handoff.mjs";
import { rememberWithStudioBrain } from "./lib/studio-brain-memory-write.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const parsed = {
    intentId: "",
    taskId: "",
    title: "",
    writeScope: "",
    riskTier: "",
    timeoutMs: Number(process.env.CODEX_PROC_TIMEOUT_MS || 45 * 60 * 1000),
    outputDir: "output/intent/codex-procs",
    model: process.env.CODEX_PROC_MODEL || "gpt-5.3-codex-spark",
    reasoningEffort: process.env.CODEX_PROC_REASONING_EFFORT || "xhigh",
    fullPermissions: String(process.env.CODEX_FULL_PERMISSIONS || "1") !== "0",
    promptOverride: "",
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (!arg) continue;

    if (arg === "--intent-id" && argv[i + 1]) {
      parsed.intentId = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--intent-id=")) {
      parsed.intentId = arg.slice("--intent-id=".length).trim();
      continue;
    }

    if (arg === "--task-id" && argv[i + 1]) {
      parsed.taskId = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--task-id=")) {
      parsed.taskId = arg.slice("--task-id=".length).trim();
      continue;
    }

    if (arg === "--title" && argv[i + 1]) {
      parsed.title = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--title=")) {
      parsed.title = arg.slice("--title=".length);
      continue;
    }

    if (arg === "--write-scope" && argv[i + 1]) {
      parsed.writeScope = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--write-scope=")) {
      parsed.writeScope = arg.slice("--write-scope=".length).trim();
      continue;
    }

    if (arg === "--risk-tier" && argv[i + 1]) {
      parsed.riskTier = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--risk-tier=")) {
      parsed.riskTier = arg.slice("--risk-tier=".length).trim();
      continue;
    }

    if (arg === "--timeout-ms" && argv[i + 1]) {
      parsed.timeoutMs = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--timeout-ms=")) {
      parsed.timeoutMs = Number(arg.slice("--timeout-ms=".length));
      continue;
    }

    if (arg === "--output-dir" && argv[i + 1]) {
      parsed.outputDir = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--output-dir=")) {
      parsed.outputDir = arg.slice("--output-dir=".length).trim();
      continue;
    }

    if (arg === "--model" && argv[i + 1]) {
      parsed.model = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--model=")) {
      parsed.model = arg.slice("--model=".length).trim();
      continue;
    }

    if (arg === "--reasoning-effort" && argv[i + 1]) {
      parsed.reasoningEffort = String(argv[i + 1]).trim();
      i += 1;
      continue;
    }
    if (arg.startsWith("--reasoning-effort=")) {
      parsed.reasoningEffort = arg.slice("--reasoning-effort=".length).trim();
      continue;
    }

    if (arg === "--prompt" && argv[i + 1]) {
      parsed.promptOverride = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith("--prompt=")) {
      parsed.promptOverride = arg.slice("--prompt=".length);
      continue;
    }

    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--limited-permissions") {
      parsed.fullPermissions = false;
      continue;
    }
    if (arg === "--full-permissions") {
      parsed.fullPermissions = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Intent Codex subprocess runner",
          "",
          "Usage:",
          "  node ./scripts/intent-codex-proc.mjs --intent-id <id> --task-id <id> [options]",
          "",
          "Options:",
          "  --title <text>               Human task title context",
          "  --write-scope <scope>        Intent write scope hint",
          "  --risk-tier <tier>           Risk tier hint",
          "  --timeout-ms <ms>            Subprocess timeout (default: 2700000)",
          "  --model <name>               Codex model (default: gpt-5.3-codex-spark)",
          "  --reasoning-effort <level>   Reasoning effort (default: xhigh)",
          "  --full-permissions           Force full permissions (default)",
          "  --limited-permissions        Disable full-permissions override",
          "  --output-dir <path>          Artifact directory",
          "  --prompt <text>              Override generated prompt",
          "  --dry-run                    Print command/report without executing",
        ].join("\n"),
      );
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!parsed.intentId) {
    throw new Error("--intent-id is required.");
  }
  if (!parsed.taskId) {
    throw new Error("--task-id is required.");
  }
  if (!Number.isFinite(parsed.timeoutMs) || parsed.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive integer.");
  }

  return parsed;
}

function cleanText(value) {
  return String(value || "").trim();
}

function buildShellStartupRunId(args) {
  const intentId = cleanText(args.intentId);
  const taskId = cleanText(args.taskId);
  if (intentId && taskId) return `${intentId}::${taskId}`;
  if (intentId) return intentId;
  if (taskId) return taskId;
  return `codex-proc-${Date.now()}`;
}

function buildStartupMemoryQuery(args) {
  return [cleanText(args.intentId), cleanText(args.taskId), cleanText(args.title), cleanText(args.writeScope), cleanText(args.riskTier)]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function readJsonFile(path, fallback = null) {
  if (!path || !existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function loadInheritedContinuity(args) {
  const satisfiedBy = cleanText(process.env.STUDIO_BRAIN_BOOTSTRAP_SATISFIED_BY || "");
  const ready = String(process.env.STUDIO_BRAIN_BOOTSTRAP_READY || "") === "1";
  if (!ready || !satisfiedBy || ["blocked", "unmet", "disabled", "bootstrap-disabled", "studio-brain-unmet"].includes(satisfiedBy)) {
    throw new Error(
      "Parent continuity bootstrap was not satisfied; intent child runs are blocked until Studio Brain startup context is ready."
    );
  }

  const threadId = cleanText(process.env.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID || "");
  const continuityEnvelopePath = cleanText(process.env.STUDIO_BRAIN_CONTINUITY_ENVELOPE_PATH || "");
  const bootstrapContextPath = cleanText(process.env.STUDIO_BRAIN_BOOTSTRAP_CONTEXT_PATH || "");
  const bootstrapMetadataPath = cleanText(process.env.STUDIO_BRAIN_BOOTSTRAP_METADATA_PATH || "");
  const handoffPath = cleanText(process.env.STUDIO_BRAIN_HANDOFF_PATH || "");
  const continuityEnvelope = readJsonFile(continuityEnvelopePath, {});
  const bootstrapContext = readJsonFile(bootstrapContextPath, {});
  const bootstrapMetadata = readJsonFile(bootstrapMetadataPath, {});
  const handoff = readJsonFile(handoffPath, {});
  const runId = buildShellStartupRunId(args);
  const query = cleanText(buildStartupMemoryQuery(args)) || cleanText(process.env.STUDIO_BRAIN_BOOTSTRAP_QUERY) || "codex intent task continuity";
  return {
    threadId,
    runId,
    query,
    continuityEnvelopePath,
    bootstrapContextPath,
    bootstrapMetadataPath,
    handoffPath,
    continuityEnvelope,
    bootstrapContext,
    bootstrapMetadata,
    handoff,
    satisfiedBy,
  };
}

async function writeIntentHandoff(args, report, inheritedContinuity) {
  const threadId = cleanText(
    inheritedContinuity?.threadId ||
      process.env.STUDIO_BRAIN_BOOTSTRAP_THREAD_ID ||
      inheritedContinuity?.bootstrapMetadata?.threadId ||
      inheritedContinuity?.handoff?.threadId
  );
  if (!threadId) return;
  const handoff = buildIntentProcHandoff(args, report, inheritedContinuity, {
    env: process.env,
    threadId,
  });
  try {
    await rememberWithStudioBrain(
      {
        kind: "handoff",
        content: handoff.summary || handoff.workCompleted || "Child intent run completed without a summary.",
        rememberForStartup: true,
        metadata: {
          ...handoff,
          status: handoff.completionStatus,
          activeGoal: handoff.activeGoal,
          nextRecommendedAction: handoff.nextRecommendedAction,
          blockers: handoff.blockers,
          artifactPointers: handoff.artifactPointers,
          startupProvenance: handoff.startupProvenance,
          agentId: handoff.agentId,
          runId: handoff.runId,
        },
      },
      {
        env: process.env,
        threadId,
        cwd: REPO_ROOT,
        threadTitle: cleanText(inheritedContinuity?.bootstrapMetadata?.threadTitle),
        firstUserMessage: cleanText(inheritedContinuity?.bootstrapMetadata?.firstUserMessage),
        capturedFrom: "codex-child-run",
      }
    );
  } catch {
    writeHandoffArtifact(threadId, handoff);
  }
}

function truncate(value, max = 6000) {
  const text = String(value || "");
  if (text.length <= max) return text;
  return `${text.slice(0, max)}...<truncated ${text.length - max} chars>`;
}

function slug(value) {
  return String(value || "task")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

async function buildPrompt(args, inheritedContinuity) {
  if (args.promptOverride && args.promptOverride.trim().length > 0) {
    return args.promptOverride.trim();
  }

  const { runId, query } = inheritedContinuity;
  const continuitySummary = cleanText(
    inheritedContinuity?.continuityEnvelope?.bootstrapSummary ||
      inheritedContinuity?.continuityEnvelope?.lastHandoffSummary ||
      inheritedContinuity?.bootstrapContext?.summary
  );

  const lines = [
    "Execute this intent task in the local repository with autonomous delivery.",
    "",
    "Task Context:",
    `- intentId: ${args.intentId}`,
    `- taskId: ${args.taskId}`,
    `- title: ${args.title || "(not provided)"}`,
    `- writeScope: ${args.writeScope || "(not provided)"}`,
    `- riskTier: ${args.riskTier || "(not provided)"}`,
    "",
    "Requirements:",
    "1. Make concrete progress with focused local edits aligned to task context.",
    "2. Run relevant verification commands for touched areas.",
    "3. Do not revert unrelated local changes.",
    "4. Summarize files changed, commands run, and remaining blockers.",
    "",
    "If the task is blocked, state the exact blocker and the smallest next action.",
    "",
    "Memory continuity bootstrap for this run:",
    `- runId: ${runId}`,
    `- startupQuery: ${query}`,
    `- startupContextTool: studio_brain_startup_context`,
    `- startupGateSatisfiedBy: ${inheritedContinuity?.satisfiedBy || "(unknown)"}`,
  ];

  if (continuitySummary) {
    lines.push("", "Loaded continuity context:", continuitySummary);
  }

  lines.push("", "Use these semantics if additional context is needed during execution:");
  lines.push("- Call studio_brain_startup_context first when continuity feels stale or incomplete.");
  lines.push("- Use studio_brain_remember to save durable decisions, blockers, progress, and handoff-worthy state in one batched write.");
  lines.push("- Keep work anchored to the inherited thread lineage and do not invent a new continuity chain.");
  lines.push("- Preserve the same runId/thread continuity in any follow-up notes or handoff.");

  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inheritedContinuity = loadInheritedContinuity(args);
  const prompt = await buildPrompt(args, inheritedContinuity);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = resolve(REPO_ROOT, args.outputDir);
  mkdirSync(outputDir, { recursive: true });

  const baseName = `${stamp}-${slug(args.taskId)}`;
  const stdoutPath = resolve(outputDir, `${baseName}.stdout.log`);
  const stderrPath = resolve(outputDir, `${baseName}.stderr.log`);
  const lastMessagePath = resolve(outputDir, `${baseName}.last-message.txt`);
  const reportPath = resolve(outputDir, `${baseName}.report.json`);

  const codexArgs = [
    ...(args.fullPermissions ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
    "exec",
    "-c",
    "mcp_servers.open_memory.enabled=true",
    "--skip-git-repo-check",
    "--model",
    args.model,
    "-c",
    `model_reasoning_effort="${args.reasoningEffort}"`,
    "--output-last-message",
    lastMessagePath,
    prompt,
  ];

  const startMs = Date.now();
  let result = null;
  if (!args.dryRun) {
    result = spawnSync("codex", codexArgs, {
      cwd: REPO_ROOT,
      env: process.env,
      encoding: "utf8",
      timeout: args.timeoutMs,
      maxBuffer: 1024 * 1024 * 48,
    });

    writeFileSync(stdoutPath, String(result.stdout || ""), "utf8");
    writeFileSync(stderrPath, String(result.stderr || ""), "utf8");
  }

  const durationMs = Date.now() - startMs;
  const timedOut = Boolean(result && result.signal === "SIGTERM" && result.status === null);
  const exitCode = args.dryRun
    ? 0
    : typeof result?.status === "number"
      ? result.status
      : timedOut
        ? 124
        : 1;

  let lastMessage = "";
  try {
    lastMessage = readFileSync(lastMessagePath, "utf8").trim();
  } catch {
    lastMessage = "";
  }

  const report = {
    schema: "intent-codex-proc.v1",
    generatedAt: new Date().toISOString(),
    status: exitCode === 0 ? "pass" : "fail",
    intentId: args.intentId,
    taskId: args.taskId,
    title: args.title,
    writeScope: args.writeScope,
    riskTier: args.riskTier,
    model: args.model,
    reasoningEffort: args.reasoningEffort,
    fullPermissions: args.fullPermissions,
    dryRun: args.dryRun,
    timeoutMs: args.timeoutMs,
    durationMs,
    command: {
      binary: "codex",
      args: codexArgs,
    },
    artifacts: {
      stdoutPath,
      stderrPath,
      lastMessagePath,
      reportPath,
    },
    result: {
      ok: exitCode === 0,
      exitCode,
      signal: result?.signal || null,
      timedOut,
      stdoutPreview: truncate(result?.stdout || ""),
      stderrPreview: truncate(result?.stderr || ""),
      lastMessage: truncate(lastMessage, 3000),
    },
  };

  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeIntentHandoff(args, report, inheritedContinuity);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`intent-codex-proc failed: ${message}\n`);
  process.exit(1);
});
