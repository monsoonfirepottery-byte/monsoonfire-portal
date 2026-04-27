#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectCodexExecJsonTelemetry } from "./lib/codex-exec-json-events.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_EXPECTED_PORTAL_HOST = "portal.monsoonfire.com";
const DEFAULT_CODEX_MODEL = clean(process.env.NATIVE_BROWSER_SHADOW_MODEL || process.env.CODEX_MODEL || "gpt-5.4-mini");
const DEFAULT_REASONING_EFFORT = clean(process.env.NATIVE_BROWSER_SHADOW_REASONING_EFFORT || "low");
const DEFAULT_TIMEOUT_MS = 240_000;

const SURFACE_DEFAULTS = {
  portal: {
    baseUrl: "https://portal.monsoonfire.com",
    outputDir: resolve(REPO_ROOT, "output", "native-browser", "portal", "prod"),
    shadowOf: "verify.portal.smoke",
    canonicalArtifactRoot: "output/playwright/portal/prod",
  },
  website: {
    baseUrl: "https://monsoonfire.com",
    outputDir: resolve(REPO_ROOT, "output", "native-browser", "website", "prod"),
    shadowOf: "verify.website.smoke",
    canonicalArtifactRoot: "output/playwright/prod",
    expectedPortalHost: DEFAULT_EXPECTED_PORTAL_HOST,
  },
};

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function clip(value, max = 4_000) {
  const normalized = String(value ?? "");
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}\n…`;
}

function buildPromptInput(prompt) {
  const normalized = String(prompt ?? "");
  return normalized.endsWith("\n") ? normalized : `${normalized}\n`;
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === __filename;
}

function defaultCodexExecutable() {
  return process.platform === "win32" ? "codex.cmd" : "codex";
}

function defaultCodexExecutionRoot() {
  const override = clean(process.env.NATIVE_BROWSER_SHADOW_EXEC_ROOT || process.env.CODEX_EXEC_ROOT);
  if (override) return resolve(override);
  const tempRoot = clean(process.env.TEMP || process.env.TMP || tmpdir());
  return resolve(tempRoot || tmpdir());
}

function resolveSurface(value) {
  const normalized = clean(value).toLowerCase();
  if (normalized === "portal" || normalized === "website") return normalized;
  throw new Error(`Unsupported surface "${value}". Use portal or website.`);
}

function resolvePathFromRepo(value, fallback) {
  const normalized = clean(value);
  return normalized ? resolve(REPO_ROOT, normalized) : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseArgs(argv) {
  const options = {
    surface: "portal",
    baseUrl: SURFACE_DEFAULTS.portal.baseUrl,
    outputDir: SURFACE_DEFAULTS.portal.outputDir,
    shadowOf: SURFACE_DEFAULTS.portal.shadowOf,
    canonicalArtifactRoot: SURFACE_DEFAULTS.portal.canonicalArtifactRoot,
    expectedPortalHost: DEFAULT_EXPECTED_PORTAL_HOST,
    deep: false,
    execute: false,
    mode: "prepare",
    benchmarkProbe: false,
    json: false,
    model: DEFAULT_CODEX_MODEL,
    reasoningEffort: DEFAULT_REASONING_EFFORT,
    codexExecutable: defaultCodexExecutable(),
    executionRoot: defaultCodexExecutionRoot(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = clean(argv[index]);
    if (!arg) continue;

    if (arg === "--surface") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --surface");
      const surface = resolveSurface(next);
      options.surface = surface;
      options.baseUrl = SURFACE_DEFAULTS[surface].baseUrl;
      options.outputDir = SURFACE_DEFAULTS[surface].outputDir;
      options.shadowOf = SURFACE_DEFAULTS[surface].shadowOf;
      options.canonicalArtifactRoot = SURFACE_DEFAULTS[surface].canonicalArtifactRoot;
      options.expectedPortalHost =
        SURFACE_DEFAULTS[surface].expectedPortalHost || DEFAULT_EXPECTED_PORTAL_HOST;
      index += 1;
      continue;
    }

    if (arg === "--base-url") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --base-url");
      options.baseUrl = clean(next).replace(/\/+$/, "");
      index += 1;
      continue;
    }

    if (arg === "--output-dir") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --output-dir");
      options.outputDir = resolvePathFromRepo(next, options.outputDir);
      index += 1;
      continue;
    }

    if (arg === "--shadow-of") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --shadow-of");
      options.shadowOf = clean(next);
      index += 1;
      continue;
    }

    if (arg === "--canonical-artifact-root") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --canonical-artifact-root");
      options.canonicalArtifactRoot = clean(next).replaceAll("\\", "/");
      index += 1;
      continue;
    }

    if (arg === "--expected-portal-host") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --expected-portal-host");
      options.expectedPortalHost = clean(next).toLowerCase();
      index += 1;
      continue;
    }

    if (arg === "--model") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --model");
      options.model = clean(next);
      index += 1;
      continue;
    }

    if (arg === "--reasoning-effort") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --reasoning-effort");
      options.reasoningEffort = clean(next);
      index += 1;
      continue;
    }

    if (arg === "--codex-executable") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --codex-executable");
      options.codexExecutable = clean(next);
      index += 1;
      continue;
    }

    if (arg === "--execution-root") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --execution-root");
      options.executionRoot = resolve(clean(next));
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      const next = argv[index + 1];
      if (!next || clean(next).startsWith("--")) throw new Error("Missing value for --timeout-ms");
      options.timeoutMs = parsePositiveInt(next, DEFAULT_TIMEOUT_MS);
      index += 1;
      continue;
    }

    if (arg === "--deep") {
      options.deep = true;
      continue;
    }

    if (arg === "--execute") {
      options.execute = true;
      options.mode = "execute";
      continue;
    }

    if (arg === "--prepare") {
      options.execute = false;
      options.mode = "prepare";
      continue;
    }

    if (arg === "--app-handoff") {
      options.execute = false;
      options.mode = "app-handoff";
      continue;
    }

    if (arg === "--benchmark-probe") {
      options.benchmarkProbe = true;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }
  }

  options.surface = resolveSurface(options.surface);
  return options;
}

function emitBenchmarkProbe(options) {
  const payload = {
    schema: "agent-tool-benchmark-probe.v1",
    tool: "native-browser-shadow-verifier",
    status: "ok",
    benchmarkProbe: true,
    options: {
      surface: options.surface,
      baseUrl: options.baseUrl,
      outputDir: options.outputDir,
      shadowOf: options.shadowOf,
      canonicalArtifactRoot: options.canonicalArtifactRoot,
      expectedPortalHost: options.expectedPortalHost,
      deep: options.deep,
      execute: options.execute,
      mode: options.mode,
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      executionRoot: options.executionRoot,
      timeoutMs: options.timeoutMs,
    },
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }

  process.stdout.write(`benchmark-probe ok: ${payload.tool}\n`);
}

function isLocalBaseUrl(baseUrl) {
  try {
    const parsed = new URL(baseUrl);
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
  } catch {
    return false;
  }
}

function buildCheckProfile(options) {
  if (options.surface === "portal") {
    const checks = [
      "Confirm the dashboard heading renders and the initial shell settles without an auth loop.",
      "Verify House, Messages, and Support entry points render without blocking runtime failures.",
      "Flag any request, script, or visible reference to localhost/127.0.0.1 Studio Brain hosts on non-local targets.",
      "Capture a desktop shell screenshot and a mobile shell screenshot for the landing experience.",
    ];
    if (options.deep) {
      checks.push("Sweep dashboard themes (light, dark, mono) and note any contrast or layout regressions.");
      checks.push("If staff routes are available, verify Staff/Cockpit paths remain reachable and visually stable.");
    }

    return {
      checks,
      recommendedScreenshots: [
        "portal-dashboard-desktop.png",
        "portal-dashboard-mobile.png",
        ...(options.deep
          ? ["portal-dashboard-theme-light.png", "portal-dashboard-theme-dark.png", "portal-dashboard-theme-mono.png"]
          : []),
      ],
    };
  }

  const checks = [
    "Verify first-view rendering on /, /services/, /kiln-firing/, /memberships/, /contact/, and /support/.",
    "Confirm the mobile navigation toggle is present and usable.",
    "Exercise the support topic filter and confirm the selected state is visibly applied.",
    "Trigger contact form validation and confirm the validation error renders.",
    `Verify portal handoff links still target ${options.expectedPortalHost}.`,
  ];

  return {
    checks,
    recommendedScreenshots: [
      "website-home-desktop.png",
      "website-home-mobile.png",
      "website-support-filter.png",
      "website-contact-validation.png",
    ],
  };
}

function buildPreparationPrompt(options, profile) {
  const runner = options.mode === "app-handoff" ? "Codex app in-app browser" : "Codex in-app browser or computer-use runner";
  if (options.surface === "portal") {
    const localityNote = isLocalBaseUrl(options.baseUrl)
      ? "Localhost Studio Brain references are allowed on this local target."
      : "Any localhost/127.0.0.1 Studio Brain reference should be treated as a regression.";

    return [
      `Use the ${runner} to verify the Monsoon Fire portal at ${options.baseUrl}.`,
      "This is an advisory shadow lane only. Do not replace the canonical Playwright gate based on this run.",
      localityNote,
      ...profile.checks.map((check, index) => `${index + 1}. ${check}`),
      "Capture the recommended screenshots and write a short summary of any blocking visual or navigation regressions.",
    ].join("\n");
  }

  return [
    `Use the ${runner} to verify the Monsoon Fire website at ${options.baseUrl}.`,
    "This is an advisory shadow lane only. Do not replace the canonical Playwright gate based on this run.",
    ...profile.checks.map((check, index) => `${index + 1}. ${check}`),
    "Capture the recommended screenshots and summarize any broken navigation, missing selectors, or handoff-host mismatches.",
  ].join("\n");
}

export function buildExecutionSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "runner", "surface", "baseUrl", "browserCapability", "summary", "checks", "artifacts", "notes"],
    properties: {
      status: {
        type: "string",
        enum: ["passed", "failed", "inconclusive", "tool_unavailable"],
      },
      runner: { type: "string", minLength: 1 },
      surface: { type: "string", enum: ["portal", "website"] },
      baseUrl: { type: "string", minLength: 1 },
      browserCapability: {
        type: "string",
        enum: ["used_in_app_browser", "used_computer_use", "used_other_native_surface", "unavailable", "unknown"],
      },
      summary: { type: "string", minLength: 1 },
      checks: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "status", "details"],
          properties: {
            name: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["passed", "failed", "not_run", "unknown"] },
            details: { type: "string", minLength: 1 },
          },
        },
      },
      artifacts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "status", "details"],
          properties: {
            label: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["captured", "described", "not_captured"] },
            details: { type: "string", minLength: 1 },
          },
        },
      },
      notes: {
        type: "array",
        items: { type: "string" },
      },
    },
  };
}

export function buildExecutionPrompt(plan, options) {
  const screenshotLabels = Array.isArray(plan.recommendedScreenshots) ? plan.recommendedScreenshots : [];
  const checks = Array.isArray(plan.checks) ? plan.checks : [];
  return [
    `You are running a bounded native-browser shadow verification for Monsoon Fire (${plan.surface}) at ${plan.baseUrl}.`,
    "Use the Codex in-app browser or computer-use surface if and only if that native capability is available in this execution environment.",
    "Do not use shell commands, repo file reads, MCP memory/context tools, email/calendar connectors, or web search.",
    "Do not perform startup diagnostics or unrelated environment investigation.",
    "Do not write files. The wrapper outside this run will persist your JSON result.",
    "If no native browser or computer-use capability is available, return status `tool_unavailable` and browserCapability `unavailable` without fabricating observations.",
    `This lane is advisory only and shadows ${plan.shadowOf}. It must not claim to replace the canonical Playwright gate.`,
    "",
    "Checks to evaluate:",
    ...checks.map((check, index) => `${index + 1}. ${check}`),
    "",
    "Suggested artifact labels:",
    ...(screenshotLabels.length > 0
      ? screenshotLabels.map((label, index) => `${index + 1}. ${label}`)
      : ["1. No screenshot suggestions were provided."]),
    "",
    "When reporting artifacts:",
    "- Use `captured` only if the native surface actually produced a screenshot or file you directly observed in this run.",
    "- Use `described` if you inspected the UI but could only describe the evidence in text.",
    "- Use `not_captured` if the artifact was not available or not inspected.",
    "",
    `Return JSON only. The JSON must match the provided schema exactly, with surface="${plan.surface}" and baseUrl="${plan.baseUrl}".`,
  ].join("\n");
}

function buildArtifacts(options) {
  const profile = buildCheckProfile(options);
  const prompt = buildPreparationPrompt(options, profile);
  const outputDirRelative = relative(REPO_ROOT, options.outputDir).replaceAll("\\", "/");
  const summaryPath = resolve(options.outputDir, "shadow-summary.json");
  const planPath = resolve(options.outputDir, "shadow-plan.json");
  const handoffPath = resolve(options.outputDir, "shadow-handoff.md");
  const execPromptPath = resolve(options.outputDir, "shadow-exec-prompt.txt");
  const execSchemaPath = resolve(options.outputDir, "shadow-exec-output-schema.json");
  const execLastMessagePath = resolve(options.outputDir, "shadow-exec-last-message.txt");
  const execResultPath = resolve(options.outputDir, "shadow-exec-result.json");
  const execReportPath = resolve(options.outputDir, "shadow-exec-report.md");

  const summary = {
    schema: "native-browser-shadow-summary.v1",
    generatedAt: new Date().toISOString(),
    tool: "native-browser-shadow-verifier",
    status: options.mode === "app-handoff" ? "app_handoff_ready" : "shadow_ready",
    advisoryOnly: true,
    gatingImpact: "non_blocking",
    surface: options.surface,
    baseUrl: options.baseUrl,
    shadowOf: options.shadowOf,
    outputDir: outputDirRelative,
    canonicalArtifactRoot: options.canonicalArtifactRoot,
    expectedPortalHost: options.surface === "website" ? options.expectedPortalHost : null,
    deep: options.deep,
    mode: options.mode,
    executionModel: {
      available: true,
      defaultRunner: options.mode === "app-handoff" ? "codex-app-in-app-browser" : "codex.exec",
      defaultModel: options.model,
      defaultReasoningEffort: options.reasoningEffort,
      defaultTimeoutMs: options.timeoutMs,
    },
    nextAction: options.execute
      ? "Execution mode requested. The wrapper will run Codex exec and persist structured evidence into this directory."
      : options.mode === "app-handoff"
        ? "Open the base URL in the Codex app in-app browser, run the handoff prompt, and attach the resulting visual notes to the generated handoff artifact."
      : "Run the prompt in Codex with the in-app browser or computer-use surface and write evidence back into this directory.",
    recommendedScreenshots: profile.recommendedScreenshots,
    artifactFiles: {
      summary: relative(REPO_ROOT, summaryPath).replaceAll("\\", "/"),
      plan: relative(REPO_ROOT, planPath).replaceAll("\\", "/"),
      handoff: relative(REPO_ROOT, handoffPath).replaceAll("\\", "/"),
      execPrompt: relative(REPO_ROOT, execPromptPath).replaceAll("\\", "/"),
      execSchema: relative(REPO_ROOT, execSchemaPath).replaceAll("\\", "/"),
      execLastMessage: relative(REPO_ROOT, execLastMessagePath).replaceAll("\\", "/"),
      execResult: relative(REPO_ROOT, execResultPath).replaceAll("\\", "/"),
      execReport: relative(REPO_ROOT, execReportPath).replaceAll("\\", "/"),
    },
  };

  const plan = {
    schema: "native-browser-shadow-plan.v1",
    generatedAt: summary.generatedAt,
    tool: summary.tool,
    status: summary.status,
    advisoryOnly: summary.advisoryOnly,
    executionModel: {
      preferredRunners: ["codex-app-in-app-browser", "codex-computer-use", "codex.exec"],
      gateImpact: summary.gatingImpact,
      intendedOutcome: "Collect native-browser evidence in parallel with the canonical Playwright smoke lane.",
      defaultRunner: options.mode === "app-handoff" ? "codex-app-in-app-browser" : "codex.exec",
      defaultModel: options.model,
      defaultReasoningEffort: options.reasoningEffort,
      defaultTimeoutMs: options.timeoutMs,
    },
    surface: options.surface,
    baseUrl: options.baseUrl,
    shadowOf: options.shadowOf,
    canonicalArtifactRoot: options.canonicalArtifactRoot,
    expectedPortalHost: options.surface === "website" ? options.expectedPortalHost : null,
    deep: options.deep,
    mode: options.mode,
    checks: profile.checks,
    recommendedScreenshots: profile.recommendedScreenshots,
    prompt,
  };

  const handoff = [
    "# Native Browser Shadow Verification",
    "",
    `- Surface: \`${options.surface}\``,
    `- Base URL: \`${options.baseUrl}\``,
    `- Shadow of: \`${options.shadowOf}\``,
    `- Canonical Playwright artifacts: \`${options.canonicalArtifactRoot}\``,
    `- Advisory only: \`true\``,
    `- Preferred runner: \`${options.mode === "app-handoff" ? "codex-app-in-app-browser" : "codex.exec"}\``,
    `- Mode: \`${options.mode}\``,
    "",
    "## Codex App Steps",
    "",
    "1. Open the base URL in the Codex app in-app browser.",
    "2. Add page comments for any visible issue that needs an agent edit.",
    "3. Use the prompt below to produce structured evidence.",
    "4. Keep this lane advisory; compare with the canonical Playwright artifact before release claims.",
    "",
    "## Prompt",
    "",
    "```text",
    prompt,
    "```",
    "",
    "## Recommended screenshots",
    ...profile.recommendedScreenshots.map((entry) => `- \`${entry}\``),
  ].join("\n");

  return {
    summaryPath,
    planPath,
    handoffPath,
    execPromptPath,
    execSchemaPath,
    execLastMessagePath,
    execResultPath,
    execReportPath,
    summary,
    plan,
    handoff,
  };
}

function writePreparationArtifacts(artifacts) {
  mkdirSync(dirname(artifacts.summaryPath), { recursive: true });
  writeFileSync(artifacts.summaryPath, `${JSON.stringify(artifacts.summary, null, 2)}\n`, "utf8");
  writeFileSync(artifacts.planPath, `${JSON.stringify(artifacts.plan, null, 2)}\n`, "utf8");
  writeFileSync(artifacts.handoffPath, `${artifacts.handoff}\n`, "utf8");
}

function runProcess({ command, args, cwd, input = "", timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl = spawn }) {
  return new Promise((resolvePromise, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const child = spawnImpl(command, args, {
      cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeoutHandle);
      resolvePromise({
        exitCode: Number.isFinite(exitCode) ? exitCode : 1,
        stdout,
        stderr,
        timedOut,
      });
    });
    child.stdin.end(buildPromptInput(input));
  });
}

export function buildCodexExecArgs({
  executionRoot,
  model,
  outputPath,
  outputSchemaPath,
  reasoningEffort = "low",
}) {
  const args = [
    "exec",
    "--json",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--disable",
    "multi_agent",
    "--disable",
    "shell_snapshot",
    "-c",
    `model_reasoning_effort="${clean(reasoningEffort) || "low"}"`,
    "-c",
    "web_search=\"disabled\"",
    "-C",
    resolve(executionRoot),
    "-m",
    clean(model) || DEFAULT_CODEX_MODEL,
    "--output-schema",
    resolve(outputSchemaPath),
    "-o",
    resolve(outputPath),
    "-",
  ];
  return args;
}

export function buildExecutionArtifacts(plan, options, execution) {
  const checks = Array.isArray(execution?.result?.checks) ? execution.result.checks : [];
  const artifacts = Array.isArray(execution?.result?.artifacts) ? execution.result.artifacts : [];
  const notes = Array.isArray(execution?.result?.notes) ? execution.result.notes : [];
  const status = clean(execution?.status || execution?.result?.status || "exec_failed");
  const browserCapability = clean(execution?.result?.browserCapability || "unknown");
  const summaryText = clean(execution?.result?.summary || execution?.error || "No summary returned.");
  const report = [
    "# Native Browser Shadow Execution",
    "",
    `- Status: \`${status}\``,
    `- Surface: \`${plan.surface}\``,
    `- Base URL: \`${plan.baseUrl}\``,
    `- Runner: \`${clean(execution?.runner || "codex.exec")}\``,
    `- Model: \`${clean(execution?.model || options.model)}\``,
    `- Reasoning effort: \`${clean(execution?.reasoningEffort || options.reasoningEffort)}\``,
    `- Browser capability: \`${browserCapability || "unknown"}\``,
    `- Token usage: \`${execution?.usage?.totalTokens ?? "n/a"}\` total, \`${execution?.usage?.reasoningTokens ?? "n/a"}\` reasoning`,
    "",
    "## Summary",
    "",
    summaryText,
    "",
    "## Checks",
    ...(checks.length > 0
      ? checks.map((check) => `- [${clean(check.status) || "unknown"}] ${clean(check.name) || "check"}: ${clean(check.details) || "No details."}`)
      : ["- No check rows were returned."]),
    "",
    "## Artifacts",
    ...(artifacts.length > 0
      ? artifacts.map((artifact) => `- [${clean(artifact.status) || "not_captured"}] ${clean(artifact.label) || "artifact"}: ${clean(artifact.details) || "No details."}`)
      : ["- No artifact rows were returned."]),
    "",
    "## Notes",
    ...(notes.length > 0 ? notes.map((note) => `- ${clean(note)}`) : ["- none"]),
  ].join("\n");

  const payload = {
    schema: "native-browser-shadow-execution.v1",
    generatedAt: new Date().toISOString(),
    tool: "native-browser-shadow-verifier",
    advisoryOnly: true,
    gatingImpact: "non_blocking",
    surface: plan.surface,
    baseUrl: plan.baseUrl,
    shadowOf: plan.shadowOf,
    status,
    runner: clean(execution?.runner || "codex.exec"),
    model: clean(execution?.model || options.model),
    reasoningEffort: clean(execution?.reasoningEffort || options.reasoningEffort),
    startedAt: clean(execution?.startedAt),
    completedAt: clean(execution?.completedAt),
    timeoutMs: options.timeoutMs,
    browserCapability,
    summary: summaryText,
    error: clean(execution?.error),
    usage: execution?.usage || null,
    codexExecJson: execution?.codexExecJson || null,
    rawOutput: clean(execution?.rawOutput),
    result: execution?.result || null,
  };

  return { payload, report };
}

async function executeShadowPlan(plan, options, artifacts) {
  const executionPrompt = buildExecutionPrompt(plan, options);
  const executionSchema = buildExecutionSchema();
  mkdirSync(dirname(artifacts.execPromptPath), { recursive: true });
  writeFileSync(artifacts.execPromptPath, `${executionPrompt}\n`, "utf8");
  writeFileSync(artifacts.execSchemaPath, `${JSON.stringify(executionSchema, null, 2)}\n`, "utf8");

  const tempRoot = mkdtempSync(join(resolve(options.executionRoot), "codex-native-browser-shadow-"));
  const startedAt = new Date().toISOString();
  try {
    const result = await runProcess({
      command: options.codexExecutable,
      args: buildCodexExecArgs({
        executionRoot: tempRoot,
        model: options.model,
        outputPath: artifacts.execLastMessagePath,
        outputSchemaPath: artifacts.execSchemaPath,
        reasoningEffort: options.reasoningEffort,
      }),
      cwd: tempRoot,
      input: executionPrompt,
      timeoutMs: options.timeoutMs,
    });
    const codexExecJson = collectCodexExecJsonTelemetry(result.stdout);
    const rawOutput = existsSync(artifacts.execLastMessagePath)
      ? readFileSync(artifacts.execLastMessagePath, "utf8")
      : "";
    const completedAt = new Date().toISOString();

    if (result.timedOut) {
      return {
        status: "exec_failed",
        runner: "codex.exec",
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        startedAt,
        completedAt,
        error: `codex exec timed out after ${options.timeoutMs}ms`,
        usage: codexExecJson.usage,
        codexExecJson,
        rawOutput: clip(rawOutput || result.stdout || result.stderr),
      };
    }

    if (result.exitCode !== 0) {
      return {
        status: "exec_failed",
        runner: "codex.exec",
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        startedAt,
        completedAt,
        error: `codex exec failed (${result.exitCode}): ${clip(result.stderr || result.stdout || "No output captured.")}`,
        usage: codexExecJson.usage,
        codexExecJson,
        rawOutput: clip(rawOutput || result.stdout || result.stderr),
      };
    }

    if (!clean(rawOutput)) {
      return {
        status: "exec_failed",
        runner: "codex.exec",
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        startedAt,
        completedAt,
        error: "codex exec completed without a final JSON message.",
        usage: codexExecJson.usage,
        codexExecJson,
        rawOutput: clip(result.stdout || result.stderr),
      };
    }

    let parsed = null;
    try {
      parsed = JSON.parse(rawOutput);
    } catch (error) {
      return {
        status: "exec_failed",
        runner: "codex.exec",
        model: options.model,
        reasoningEffort: options.reasoningEffort,
        startedAt,
        completedAt,
        error: `codex exec output was not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        usage: codexExecJson.usage,
        codexExecJson,
        rawOutput: clip(rawOutput),
      };
    }

    return {
      status: clean(parsed?.status) || "inconclusive",
      runner: "codex.exec",
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      startedAt,
      completedAt,
      usage: codexExecJson.usage,
      codexExecJson,
      rawOutput: clip(rawOutput),
      result: parsed,
    };
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeExecutionArtifacts(artifacts, summary, executionArtifacts) {
  writeFileSync(artifacts.summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  writeFileSync(artifacts.execResultPath, `${JSON.stringify(executionArtifacts.payload, null, 2)}\n`, "utf8");
  writeFileSync(artifacts.execReportPath, `${executionArtifacts.report}\n`, "utf8");
}

export async function runShadowVerification(rawArgs = process.argv.slice(2)) {
  const options = parseArgs(rawArgs);
  if (options.benchmarkProbe) {
    emitBenchmarkProbe(options);
    return { mode: "benchmark-probe", options };
  }

  const artifacts = buildArtifacts(options);
  writePreparationArtifacts(artifacts);

  if (!options.execute) {
    if (options.json) {
      process.stdout.write(`${JSON.stringify(artifacts.summary, null, 2)}\n`);
    } else {
      process.stdout.write("Native browser shadow verifier\n");
      process.stdout.write(`  surface: ${artifacts.summary.surface}\n`);
      process.stdout.write(`  status: ${artifacts.summary.status}\n`);
      process.stdout.write(`  summary: ${artifacts.summary.artifactFiles.summary}\n`);
      process.stdout.write(`  plan: ${artifacts.summary.artifactFiles.plan}\n`);
      process.stdout.write(`  handoff: ${artifacts.summary.artifactFiles.handoff}\n`);
      if (options.mode === "app-handoff") {
        process.stdout.write(`  browser url: ${artifacts.summary.baseUrl}\n`);
      }
    }
    return { mode: options.mode, options, artifacts };
  }

  const execution = await executeShadowPlan(artifacts.plan, options, artifacts);
  const executionArtifacts = buildExecutionArtifacts(artifacts.plan, options, execution);
  const updatedSummary = {
    ...artifacts.summary,
    status: clean(execution.status || "exec_failed"),
    nextAction:
      clean(execution.status) === "tool_unavailable"
        ? "Native browser/computer-use was unavailable for codex exec. Keep the shadow lane advisory-only and use the prepared handoff files if you want to run it from an interactive Codex surface."
        : clean(execution.status) === "exec_failed"
          ? "Codex exec failed before producing a valid shadow result. Inspect the execution result artifact and rerun with a wider timeout or a different model if needed."
          : "Execution completed. Review the execution report and compare it with the canonical Playwright artifacts.",
    latestExecution: {
      runner: executionArtifacts.payload.runner,
      model: executionArtifacts.payload.model,
      reasoningEffort: executionArtifacts.payload.reasoningEffort,
      status: executionArtifacts.payload.status,
      browserCapability: executionArtifacts.payload.browserCapability,
      startedAt: executionArtifacts.payload.startedAt,
      completedAt: executionArtifacts.payload.completedAt,
      resultArtifact: artifacts.summary.artifactFiles.execResult,
      reportArtifact: artifacts.summary.artifactFiles.execReport,
    },
  };
  writeExecutionArtifacts(artifacts, updatedSummary, executionArtifacts);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(executionArtifacts.payload, null, 2)}\n`);
  } else {
    process.stdout.write("Native browser shadow verifier\n");
    process.stdout.write(`  surface: ${updatedSummary.surface}\n`);
    process.stdout.write(`  status: ${updatedSummary.status}\n`);
    process.stdout.write(`  exec result: ${updatedSummary.artifactFiles.execResult}\n`);
    process.stdout.write(`  exec report: ${updatedSummary.artifactFiles.execReport}\n`);
  }

  return { mode: "execute", options, artifacts, execution: executionArtifacts.payload };
}

async function main() {
  try {
    await runShadowVerification();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (isDirectExecution()) {
  main();
}
