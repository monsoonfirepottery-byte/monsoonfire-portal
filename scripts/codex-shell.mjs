#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAutomationStartupMemoryContext } from "./codex/open-memory-automation.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function loadEnvFile(filePath) {
  const envFile = resolve(REPO_ROOT, filePath);
  if (!existsSync(envFile)) {
    return;
  }

  const content = String(readFileSync(envFile, "utf8"));
  for (const rawLine of content.split(/[\r\n]+/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const eqIndex = line.indexOf("=");
    if (eqIndex < 0) {
      continue;
    }

    const key = line.slice(0, eqIndex).trim().replace(/^export\s+/, "");
    let value = line.slice(eqIndex + 1).trim();

    if (!key || /\s/.test(key)) {
      continue;
    }

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key]) {
      continue;
    }

    process.env[key] = value;
  }
}

function loadShellEnv() {
  loadEnvFile("secrets/studio-brain/studio-brain-automation.env");
  loadEnvFile("studio-brain/.env");
  loadEnvFile("studio-brain/.env.local");
  loadEnvFile("secrets/portal/portal-automation.env");
}

function clean(value) {
  return String(value || "").trim();
}

function isEnabled(value, defaultValue = true) {
  const raw = clean(value).toLowerCase();
  if (!raw) return defaultValue;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  return defaultValue;
}

function parseArgs(argv) {
  const options = {
    bootstrap: true,
    query: "",
    runId: "",
    expandRelationships: "",
    maxHops: "",
    contextPath: "",
    contextMaxChars: "",
    contextBootstrap: true,
    shellArgs: [],
  };

  let index = 0;
  while (index < argv.length) {
    const arg = clean(argv[index]);
    if (arg === "--no-bootstrap") {
      options.bootstrap = false;
      index += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      process.stdout.write([
        "Codex shell bootstrap launcher",
        "",
        "Usage:",
        "  node ./scripts/codex-shell.mjs [options] [codex args...]",
        "",
        "Options:",
        "  --query <text>       Query for startup_memory_context",
        "  --query=<text>       Same as --query",
        "  --run-id <id>        Stable run id for this shell session",
        "  --run-id=<id>        Same as --run-id",
        "  --expand-relationships <bool>  Pass to startup context expansion (default follows env)",
        "  --expand-relationships=<bool>  Same as above",
        "  --max-hops <n>       Relationship hop limit for startup context",
        "  --max-hops=<n>       Same as --max-hops",
        "  --context-path <p>   Local context file path to inject every shell start",
        "  --context-path=<p>   Same as --context-path",
        "  --context-max-chars <n>  Max chars from local context (default follows env)",
        "  --context-max-chars=<n>  Same as --context-max-chars",
        "  --no-context         Skip local context bootstrap injection",
        "  --no-bootstrap       Skip startup memory context injection",
        "  --help, -h           Show this help",
        "",
        "Environment defaults:",
        "  CODEX_OPEN_MEMORY_BOOTSTRAP_QUERY",
        "  CODEX_OPEN_MEMORY_RUN_ID",
        "  CODEX_OPEN_MEMORY_REUSE_LAST_RUN_ID",
        "  CODEX_OPEN_MEMORY_SESSION_STATE_PATH",
        "  CODEX_OPEN_MEMORY_SESSION_TTL_MS",
        "  CODEX_OPEN_MEMORY_EXPAND_RELATIONSHIPS",
        "  CODEX_OPEN_MEMORY_MAX_HOPS",
        "  CODEX_SHELL_CONTEXT_PATH",
        "  CODEX_SHELL_CONTEXT_MAX_CHARS",
        "  CODEX_SHELL_CONTEXT_BOOTSTRAP",
        "  CODEX_ENABLE_CONTEXT7_ON_SHELL",
        "",
        "Examples:",
        "  node ./scripts/codex-shell.mjs",
        "  node ./scripts/codex-shell.mjs --query \"resume yesterday\" --run-id my-shell-001",
        "  node ./scripts/codex-shell.mjs --context-path output/codex-shell-context.md",
        "  node ./scripts/codex-shell.mjs --no-bootstrap",
      ].join("\n"));
      process.exit(0);
    }
    if (arg === "--query" && argv[index + 1]) {
      options.query = String(argv[index + 1]).trim();
      index += 2;
      continue;
    }
    if (arg.startsWith("--query=")) {
      options.query = arg.slice("--query=".length).trim();
      index += 1;
      continue;
    }
    if (arg === "--run-id" && argv[index + 1]) {
      options.runId = String(argv[index + 1]).trim();
      index += 2;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      options.runId = arg.slice("--run-id=".length).trim();
      index += 1;
      continue;
    }
    if (arg === "--expand-relationships" && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      options.expandRelationships = argv[index + 1];
      index += 2;
      continue;
    }
    if (arg === "--expand-relationships") {
      options.expandRelationships = "true";
      index += 1;
      continue;
    }
    if (arg.startsWith("--expand-relationships=")) {
      options.expandRelationships = arg.slice("--expand-relationships=".length);
      index += 1;
      continue;
    }
    if (arg === "--max-hops" && argv[index + 1]) {
      options.maxHops = argv[index + 1];
      index += 2;
      continue;
    }
    if (arg.startsWith("--max-hops=")) {
      options.maxHops = arg.slice("--max-hops=".length);
      index += 1;
      continue;
    }
    if (arg === "--context-path" && argv[index + 1]) {
      options.contextPath = String(argv[index + 1]).trim();
      index += 2;
      continue;
    }
    if (arg.startsWith("--context-path=")) {
      options.contextPath = arg.slice("--context-path=".length).trim();
      index += 1;
      continue;
    }
    if (arg === "--context-max-chars" && argv[index + 1]) {
      options.contextMaxChars = argv[index + 1];
      index += 2;
      continue;
    }
    if (arg.startsWith("--context-max-chars=")) {
      options.contextMaxChars = arg.slice("--context-max-chars=".length);
      index += 1;
      continue;
    }
    if (arg === "--no-context") {
      options.contextBootstrap = false;
      index += 1;
      continue;
    }

    options.shellArgs.push(argv[index]);
    index += 1;
  }

  return options;
}

function readJSON(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function resolveShellSessionStatePath(env = process.env) {
  const override = clean(env.CODEX_OPEN_MEMORY_SESSION_STATE_PATH || env.CODEX_OPEN_MEMORY_SESSION_STATE || "");
  return override ? resolve(REPO_ROOT, override) : resolve(REPO_ROOT, "output", "codex-shell-state.json");
}

function readShellSessionState(statePath) {
  try {
    return readJSON(readFileSync(statePath, "utf8"), {});
  } catch {
    return {};
  }
}

function writeShellSessionState(statePath, payload) {
  const now = new Date().toISOString();
  const next = {
    updatedAt: now,
    updatedAtEpochMs: Date.now(),
    ...payload,
  };
  try {
    mkdirSync(dirname(statePath), { recursive: true });
    writeFileSync(statePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    // best effort
  }
}

function parseMs(raw, fallback) {
  const parsed = Number.parseInt(clean(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parsePositiveInt(raw, fallback) {
  const parsed = Number.parseInt(clean(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function getReusableShellState(statePath, env = process.env) {
  if (!isEnabled(env.CODEX_OPEN_MEMORY_REUSE_LAST_RUN_ID, true)) {
    return null;
  }

  const state = readShellSessionState(statePath);
  const lastRunId = clean(state.lastRunId || state.runId || "");
  const lastUpdatedMs = Number.parseInt(clean(state.updatedAtEpochMs), 10);
  const ttlMs = parseMs(env.CODEX_OPEN_MEMORY_SESSION_TTL_MS, 12 * 60 * 60 * 1000);
  if (!lastRunId || !Number.isFinite(lastUpdatedMs)) {
    return null;
  }

  if (Date.now() - lastUpdatedMs >= ttlMs) {
    return null;
  }

  return state;
}

function buildStartupRunId(options, env = process.env, reusableState = null) {
  if (options.runId) return options.runId;
  const envRunId = clean(env.CODEX_OPEN_MEMORY_RUN_ID || env.CODEX_SHELL_RUN_ID || env.CODEX_OPEN_MEMORY_SESSION_ID || "");
  if (envRunId) return envRunId;

  const candidateRunId = clean((reusableState && (reusableState.lastRunId || reusableState.runId)) || "");
  if (candidateRunId) return candidateRunId;

  const now = new Date().toISOString().replace(/[:.]/g, "-");
  return `codex-shell-${now}`;
}

function buildScopedDefaultBootstrapQuery(runId, reusableState = null, env = process.env) {
  const repoHint = clean(env.CODEX_OPEN_MEMORY_REPO_HINT || basename(REPO_ROOT) || "repo");
  const previousIntent = clean((reusableState && reusableState.query) || "");
  if (previousIntent) return previousIntent;
  return `codex shell continuity ${repoHint} run ${runId} active tasks decisions blockers`;
}

function resolveLocalContextPath(options, env = process.env) {
  const override = clean(options.contextPath || env.CODEX_SHELL_CONTEXT_PATH || "");
  if (override) {
    return resolve(REPO_ROOT, override);
  }
  return resolve(REPO_ROOT, "output", "codex-shell-context.md");
}

function loadLocalContextSummary(contextPath, maxChars, reusableState = null) {
  const fallbackFromState = clean((reusableState && (reusableState.contextSummary || reusableState.startupContextSummary)) || "");
  if (existsSync(contextPath)) {
    const raw = clean(readFileSync(contextPath, "utf8"));
    if (raw) {
      return {
        summary: raw.slice(0, maxChars),
        source: "context-file",
        contextPath,
        error: "",
      };
    }
  }

  if (fallbackFromState) {
    return {
      summary: fallbackFromState.slice(0, maxChars),
      source: "session-state",
      contextPath,
      error: "",
    };
  }

  return {
    summary: "",
    source: "",
    contextPath,
    error: "empty-context",
  };
}

function buildShellPrompt({ runId, query, memoryContext, localContext, localContextSource, error = null, localContextError = "" }) {
  const lines = [
    "You are starting a fresh Codex shell session.",
    "Keep session continuity by treating this as an active working context and persist memory lookups.",
    `runId: ${runId}`,
    `startupQuery: ${query || "Codex interactive shell continuity"}`,
    "Use open_memory.startup_memory_context first; if context is thin, call open_memory.search_memory with runId, agentId, and retrievalMode=hybrid.",
    "When context is needed later, preserve continuity by passing runId in startup/lookups.",
  ];

  if (memoryContext) {
    lines.push("Startup memory context:");
    lines.push(memoryContext);
  } else if (error) {
    lines.push(`Startup memory unavailable: ${error}`);
  }

  if (localContext) {
    lines.push(`Startup local context (${localContextSource || "local"}):`);
    lines.push(localContext);
  } else if (localContextError) {
    lines.push(`Startup local context unavailable: ${localContextError}`);
  }

  return lines.join("\n");
}

async function main() {
  loadShellEnv();

  const options = parseArgs(process.argv.slice(2));
  const statePath = resolveShellSessionStatePath();
  const reusableState = getReusableShellState(statePath);
  const runId = buildStartupRunId(options, process.env, reusableState);
  const shellModel = clean(process.env.CODEX_SHELL_MODEL || process.env.CODEX_PROC_MODEL || "gpt-5.3-codex-spark");
  const localContextPath = resolveLocalContextPath(options, process.env);
  const localContextMaxChars = parsePositiveInt(
    options.contextMaxChars || process.env.CODEX_SHELL_CONTEXT_MAX_CHARS || "",
    2000
  );
  const localContextEnabled = options.contextBootstrap && isEnabled(process.env.CODEX_SHELL_CONTEXT_BOOTSTRAP, true);
  const localContextEnvelope = localContextEnabled
    ? loadLocalContextSummary(localContextPath, localContextMaxChars, reusableState)
    : {
        summary: "",
        source: "",
        contextPath: localContextPath,
        error: "context-bootstrap-disabled",
      };
  const queryOverride = clean(process.env.CODEX_OPEN_MEMORY_BOOTSTRAP_QUERY || "");
  const scopedDefaultQuery = buildScopedDefaultBootstrapQuery(runId, reusableState, process.env);
  const bootstrapQuery = clean(options.query || queryOverride || scopedDefaultQuery);
  const querySource = options.query ? "cli" : queryOverride ? "env" : reusableState?.query ? "previous-state" : "scoped-default";

  let bootstrapPrompt = "";
  if (options.bootstrap) {
    const query = bootstrapQuery;
    const startupMemoryContext = await loadAutomationStartupMemoryContext({
      tool: "codex-shell",
      runId,
      query,
      maxItems: 12,
      maxChars: 3600,
      scanLimit: 180,
      expandRelationships: options.expandRelationships || undefined,
      maxHops: options.maxHops || undefined,
    });
    const hasContextSummary = clean(startupMemoryContext?.contextSummary || "").length > 0;
    const contextError = startupMemoryContext?.ok
      ? hasContextSummary
        ? null
        : "empty-context"
      : startupMemoryContext?.attempted
        ? startupMemoryContext.error
        : "not configured";

    bootstrapPrompt = buildShellPrompt({
      runId,
      query,
      memoryContext: hasContextSummary ? startupMemoryContext.contextSummary : "",
      localContext: localContextEnvelope.summary,
      localContextSource: localContextEnvelope.source,
      error: contextError,
      localContextError: localContextEnvelope.error,
    });
  } else {
    bootstrapPrompt = "";
  }

  const codexArgs = [];
  codexArgs.push("-c", "mcp_servers.open_memory.enabled=true");
  if (isEnabled(process.env.CODEX_ENABLE_CONTEXT7_ON_SHELL, true)) {
    codexArgs.push("-c", "mcp_servers.context7_docs.enabled=true");
  }
  if (shellModel) {
    codexArgs.push("-m", shellModel);
  }

  if (options.shellArgs.length > 0) {
    codexArgs.push(...options.shellArgs);
  } else if (bootstrapPrompt) {
    codexArgs.push(bootstrapPrompt);
  }

  if (!options.shellArgs.length && !bootstrapPrompt) {
    // start raw interactive CLI when bootstrap disabled
  }

  writeShellSessionState(statePath, {
    runId,
    lastRunId: runId,
    query: bootstrapQuery,
    querySource,
    contextPath: localContextEnvelope.contextPath,
    contextSummary: localContextEnvelope.summary,
    contextSource: localContextEnvelope.source,
    contextBootstrapEnabled: localContextEnabled,
    status: "running",
    bootstrap: options.bootstrap,
    model: shellModel || null,
    shellArgs: options.shellArgs,
    shellStatePath: statePath,
  });

  let result;
  try {
    result = spawnSync("codex", codexArgs, {
      cwd: REPO_ROOT,
      stdio: "inherit",
      env: process.env,
      shell: false,
    });
  } finally {
    writeShellSessionState(statePath, {
      runId,
      lastRunId: runId,
      query: bootstrapQuery,
      querySource,
      contextPath: localContextEnvelope.contextPath,
      contextSummary: localContextEnvelope.summary,
      contextSource: localContextEnvelope.source,
      contextBootstrapEnabled: localContextEnabled,
      status: result?.status === undefined ? "launch-failed" : `exit-${result.status}`,
      exitStatus: result?.status ?? null,
      bootstrap: options.bootstrap,
      model: shellModel || null,
      shellArgs: options.shellArgs,
      shellStatePath: statePath,
    });
  }

  if (typeof result.status === "number") {
    process.exit(result.status);
  }
  process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`codex-shell failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
