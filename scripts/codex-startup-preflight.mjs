#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAutomationStartupMemoryContext } from "./codex/open-memory-automation.mjs";
import { loadCodexAutomationEnv } from "./lib/codex-automation-env.mjs";
import {
  STARTUP_REASON_CODES,
  clean,
  evaluateStartupLatency,
  inspectTokenFreshness,
  startupRecoveryStep,
} from "./lib/codex-startup-reliability.mjs";
import { hydrateStudioBrainAuthFromPortal } from "./lib/studio-brain-startup-auth.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function parseArgs(argv) {
  const options = {
    json: false,
    includeMcpSmoke: true,
    query: "codex shell startup preflight",
    runId: "codex-startup-preflight",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "").trim();
    if (!arg) continue;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--skip-mcp-smoke") {
      options.includeMcpSmoke = false;
      continue;
    }
    if (arg === "--query" && argv[index + 1]) {
      options.query = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--query=")) {
      options.query = arg.slice("--query=".length).trim();
      continue;
    }
    if (arg === "--run-id" && argv[index + 1]) {
      options.runId = String(argv[index + 1]).trim();
      index += 1;
      continue;
    }
    if (arg.startsWith("--run-id=")) {
      options.runId = arg.slice("--run-id=".length).trim();
    }
  }
  return options;
}

async function probeStudioBrainReachability(baseUrl) {
  const startedAt = Date.now();
  try {
    const response = await fetch(new URL("/healthz", baseUrl));
    return {
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      error: response.ok ? "" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function probeMcpBridge() {
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, [resolve(REPO_ROOT, "studio-brain-mcp", "smoke.mjs")], {
    cwd: resolve(REPO_ROOT, "studio-brain-mcp"),
    encoding: "utf8",
    env: process.env,
    timeout: 45_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: typeof result.status === "number" ? result.status : 1,
    latencyMs: Date.now() - startedAt,
    stdout: clean(result.stdout),
    stderr: clean(result.stderr),
    error:
      result.error instanceof Error
        ? result.error.message
        : result.status === 0
          ? ""
          : clean(result.stderr || result.stdout) || "Studio Brain MCP smoke failed",
  };
}

async function main() {
  loadCodexAutomationEnv({ repoRoot: REPO_ROOT, env: process.env });
  const options = parseArgs(process.argv.slice(2));
  const hydration = await hydrateStudioBrainAuthFromPortal({ repoRoot: REPO_ROOT, env: process.env }).catch(() => ({
    ok: false,
    hydrated: false,
    reason: "auth_hydration_failed",
    source: "codex-startup-preflight",
    tokenFreshness: inspectTokenFreshness(""),
  }));
  const baseUrl = clean(resolveStudioBrainBaseUrlFromEnv({ env: process.env })).replace(/\/$/, "");
  const token = clean(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || process.env.STUDIO_BRAIN_MCP_ID_TOKEN || "");
  const tokenFreshness = inspectTokenFreshness(token);
  const reachability = await probeStudioBrainReachability(baseUrl);
  const startup = await loadAutomationStartupMemoryContext({
    tool: "codex-startup-preflight",
    runId: options.runId,
    query: options.query,
    maxItems: 8,
    maxChars: 2200,
    scanLimit: 120,
  });
  const startupLatency = startup.startupLatency || evaluateStartupLatency(startup.latencyMs);
  const mcpBridge = options.includeMcpSmoke ? probeMcpBridge() : null;
  const status =
    reachability.ok &&
    startup.reasonCode !== STARTUP_REASON_CODES.MISSING_TOKEN &&
    startup.reasonCode !== STARTUP_REASON_CODES.EXPIRED_TOKEN &&
    startup.reasonCode !== STARTUP_REASON_CODES.TRANSPORT_UNREACHABLE &&
    startup.reasonCode !== STARTUP_REASON_CODES.TIMEOUT &&
    (!mcpBridge || mcpBridge.ok)
      ? "pass"
      : "fail";

  const report = {
    schema: "codex-startup-preflight.v1",
    generatedAt: new Date().toISOString(),
    status,
    baseUrl,
    checks: {
      studioBrainReachability: reachability,
      authHydration: hydration,
      tokenFreshness,
      startupContext: {
        attempted: Boolean(startup.attempted),
        ok: Boolean(startup.ok),
        reason: clean(startup.reason),
        reasonCode: clean(startup.reasonCode || STARTUP_REASON_CODES.STARTUP_UNAVAILABLE),
        error: clean(startup.error),
        itemCount: Number(startup.itemCount || 0),
        contextSummary: clean(startup.contextSummary).slice(0, 300),
        latency: startupLatency,
        recoveryStep: startupRecoveryStep(startup.reasonCode || STARTUP_REASON_CODES.STARTUP_UNAVAILABLE),
      },
      ...(mcpBridge ? { mcpBridge } : {}),
    },
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`status: ${report.status}\n`);
  process.stdout.write(`studio brain: ${reachability.ok ? "reachable" : `unreachable (${reachability.error || "unknown"})`}\n`);
  process.stdout.write(`token: ${tokenFreshness.state}\n`);
  process.stdout.write(`startup reason: ${report.checks.startupContext.reasonCode}\n`);
  process.stdout.write(`startup latency: ${startupLatency.latencyMs ?? "n/a"}ms (${startupLatency.state})\n`);
  if (mcpBridge) {
    process.stdout.write(`mcp bridge: ${mcpBridge.ok ? "reachable" : `unreachable (${mcpBridge.error || "unknown"})`}\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`codex-startup-preflight failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
