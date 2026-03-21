#!/usr/bin/env node

/* eslint-disable no-console */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const defaultPortalAutomationEnvPath = resolve(repoRoot, "secrets", "portal", "portal-automation.env");

const DEFAULT_PROJECT = process.env.FIREBASE_PROJECT || "monsoonfire-portal";
const DEFAULT_TARGET = "functions-hosting";
const DEFAULT_WAVE_SIZE = 3;
const DEFAULT_COOLDOWN_SECONDS = 75;
const DEFAULT_QUOTA_RETRIES = 1;

const FIREBASE_WEB_APP_ID = "1:667865114946:web:7275b02c9345aa975200db";
const FIREBASE_API_KEY_REGEX = /^AIza[0-9A-Za-z_-]{20,}$/;
const FIREBASE_COMPILED_KEY_REGEX = /AIza[0-9A-Za-z_-]{20,}/;
const FIREBASE_MISSING_KEY_TOKEN = "MISSING_VITE_FIREBASE_API_KEY";

const QUOTA_SENSITIVE_FUNCTIONS = new Set([
  "adminSkipNowPlaying",
  "adminSetPlaybackState",
  "getEvent",
  "listEventSignups",
  "listIndustryEvents",
  "createReservation",
  "refreshLibraryIsbnMetadata",
]);

function loadPortalAutomationEnv() {
  const configuredPath = String(process.env.PORTAL_AUTOMATION_ENV_PATH || "").trim();
  const envPath = configuredPath || defaultPortalAutomationEnvPath;
  if (!envPath || !existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf8");
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (String(process.env[key] || "").trim()) continue;

    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseArgs(argv) {
  const options = {
    project: DEFAULT_PROJECT,
    target: DEFAULT_TARGET,
    functionsRaw: "",
    waveSize: DEFAULT_WAVE_SIZE,
    cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
    quotaRetries: DEFAULT_QUOTA_RETRIES,
    allowBroadFunctions: false,
    nonInteractive: true,
    asJson: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--project") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --project");
      options.project = String(next).trim();
      i += 1;
      continue;
    }
    if (arg === "--target") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --target");
      options.target = String(next).trim();
      i += 1;
      continue;
    }
    if (arg === "--functions") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --functions");
      options.functionsRaw = String(next).trim();
      i += 1;
      continue;
    }
    if (arg === "--wave-size") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --wave-size");
      options.waveSize = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--cooldown-seconds") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --cooldown-seconds");
      options.cooldownSeconds = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--quota-retries") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --quota-retries");
      options.quotaRetries = Number(next);
      i += 1;
      continue;
    }
    if (arg === "--allow-broad-functions") {
      options.allowBroadFunctions = true;
      continue;
    }
    if (arg === "--interactive") {
      options.nonInteractive = false;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  const validTargets = new Set(["functions", "hosting", "functions-hosting"]);
  if (!validTargets.has(options.target)) {
    throw new Error(`--target must be one of: ${Array.from(validTargets).join(", ")}`);
  }
  if (!Number.isFinite(options.waveSize) || options.waveSize <= 0) {
    throw new Error("--wave-size must be a positive number.");
  }
  if (!Number.isFinite(options.cooldownSeconds) || options.cooldownSeconds < 0) {
    throw new Error("--cooldown-seconds must be zero or greater.");
  }
  if (!Number.isFinite(options.quotaRetries) || options.quotaRetries < 0) {
    throw new Error("--quota-retries must be zero or greater.");
  }

  return options;
}

function parseFunctions(raw) {
  if (!raw) return [];
  const out = [];
  const seen = new Set();
  for (const token of raw.split(",")) {
    const name = token.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isQuotaError(output) {
  const text = String(output || "");
  return /quota exceeded/i.test(text) || /http error:\s*429/i.test(text) || /resource_exhausted/i.test(text);
}

function summarizeSecret(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "<empty>";
  if (trimmed.length <= 10) return `${trimmed[0]}***`;
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function looksLikeFirebaseApiKey(value) {
  return FIREBASE_API_KEY_REGEX.test(String(value || "").trim());
}

function parseJsonObjectFromMixedOutput(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    try {
      return JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    } catch {
      return null;
    }
  }
}

function detectFirebaseApiKeyFailureSignature(output) {
  const text = String(output || "");
  const lowered = text.toLowerCase();
  if (!lowered.trim()) return null;

  if (lowered.includes("missing vite_firebase_api_key")) {
    return {
      code: "missing_vite_firebase_api_key",
      message: "Frontend build/runtime is missing VITE_FIREBASE_API_KEY.",
    };
  }
  if (lowered.includes(FIREBASE_MISSING_KEY_TOKEN.toLowerCase())) {
    return {
      code: "compiled_missing_vite_firebase_api_key_token",
      message: `Compiled bundle contains ${FIREBASE_MISSING_KEY_TOKEN}.`,
    };
  }
  if (/api key not valid|api_key_invalid/i.test(text)) {
    return {
      code: "firebase_api_key_invalid",
      message: "Firebase Identity Toolkit rejected the API key as invalid.",
    };
  }
  if (/identitytoolkit\.googleapis\.com/i.test(text) && /\s400\b/.test(lowered)) {
    return {
      code: "identity_toolkit_400",
      message: "Identity Toolkit returned HTTP 400 during auth bootstrap.",
    };
  }

  return null;
}

function runCapture(command, args, options = {}) {
  return spawnSync(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
    encoding: "utf8",
    env: options.env || process.env,
    cwd: options.cwd || repoRoot,
  });
}

function resolveFirebaseWebApiKey({ project, env = process.env, cwd = repoRoot }) {
  const candidates = [
    { source: "VITE_FIREBASE_API_KEY", value: env.VITE_FIREBASE_API_KEY },
    { source: "PORTAL_FIREBASE_API_KEY", value: env.PORTAL_FIREBASE_API_KEY },
    { source: "FIREBASE_WEB_API_KEY", value: env.FIREBASE_WEB_API_KEY },
  ];

  const attempts = [];
  for (const candidate of candidates) {
    const key = String(candidate.value || "").trim();
    if (!key) {
      attempts.push({
        source: candidate.source,
        status: "missing",
        keySummary: summarizeSecret(key),
      });
      continue;
    }
    if (!looksLikeFirebaseApiKey(key)) {
      attempts.push({
        source: candidate.source,
        status: "invalid_format",
        keySummary: summarizeSecret(key),
      });
      continue;
    }
    attempts.push({
      source: candidate.source,
      status: "valid_format",
      keySummary: summarizeSecret(key),
    });
    return {
      ok: true,
      key,
      source: candidate.source,
      keySummary: summarizeSecret(key),
      attempts,
    };
  }

  const sdkConfig = runCapture(
    "npx",
    ["firebase-tools", "apps:sdkconfig", "web", FIREBASE_WEB_APP_ID, "--project", project],
    { env, cwd }
  );
  const payload = parseJsonObjectFromMixedOutput(sdkConfig.stdout);
  const sdkKey = String(payload?.apiKey || "").trim();
  if (sdkConfig.status === 0 && looksLikeFirebaseApiKey(sdkKey)) {
    attempts.push({
      source: "firebase-tools-apps:sdkconfig",
      status: "valid_format",
      keySummary: summarizeSecret(sdkKey),
    });
    return {
      ok: true,
      key: sdkKey,
      source: "firebase-tools-apps:sdkconfig",
      keySummary: summarizeSecret(sdkKey),
      attempts,
    };
  }

  attempts.push({
    source: "firebase-tools-apps:sdkconfig",
    status: sdkConfig.status === 0 ? "invalid_format" : "failed",
    keySummary: summarizeSecret(sdkKey),
  });

  return {
    ok: false,
    message:
      "Unable to resolve a valid Firebase Web API key (checked VITE_FIREBASE_API_KEY, PORTAL_FIREBASE_API_KEY, FIREBASE_WEB_API_KEY, and firebase-tools apps:sdkconfig).",
    attempts,
    sdkconfig: {
      status: sdkConfig.status ?? 1,
      stderr: String(sdkConfig.stderr || "").trim(),
    },
  };
}

function collectFiles(rootDir, includeFile) {
  const files = [];
  const queue = [rootDir];

  while (queue.length > 0) {
    const current = queue.pop();
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(entryPath);
        continue;
      }
      if (includeFile(entryPath)) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function inspectFirebaseBuildArtifacts(jsAssets) {
  const placeholderTokenFiles = [];
  const compiledApiKeyFiles = [];

  for (const asset of jsAssets) {
    const path = String(asset.path || "");
    const content = String(asset.content || "");
    if (content.includes(FIREBASE_MISSING_KEY_TOKEN)) {
      placeholderTokenFiles.push(path);
    }
    if (FIREBASE_COMPILED_KEY_REGEX.test(content)) {
      compiledApiKeyFiles.push(path);
    }
  }

  if (compiledApiKeyFiles.length === 0) {
    return {
      ok: false,
      code:
        placeholderTokenFiles.length > 0
          ? "firebase_api_key_placeholder_token_detected"
          : "firebase_api_key_not_embedded",
      message:
        placeholderTokenFiles.length > 0
          ? `Build output contains ${FIREBASE_MISSING_KEY_TOKEN} without a compiled Firebase API key value.`
          : "Build output does not contain a compiled Firebase API key value.",
      placeholderTokenFiles,
      compiledApiKeyFiles,
    };
  }

  if (placeholderTokenFiles.length > 0) {
    return {
      ok: false,
      code: "firebase_api_key_placeholder_token_detected",
      message: `Build output still contains ${FIREBASE_MISSING_KEY_TOKEN}.`,
      placeholderTokenFiles,
      compiledApiKeyFiles,
    };
  }

  return {
    ok: true,
    code: "firebase_api_key_embedded",
    placeholderTokenFiles,
    compiledApiKeyFiles,
  };
}

function inspectFirebaseBuildArtifactsFromDist(distDir) {
  if (!existsSync(distDir)) {
    return {
      ok: false,
      code: "dist_missing",
      message: `Missing build output directory: ${distDir}`,
      placeholderTokenFiles: [],
      compiledApiKeyFiles: [],
    };
  }
  const jsFiles = collectFiles(distDir, (filePath) => filePath.endsWith(".js"));
  const assets = jsFiles.map((filePath) => ({
    path: filePath,
    content: readFileSync(filePath, "utf8"),
  }));
  return inspectFirebaseBuildArtifacts(assets);
}

function runHostingBuildGuard({ env }) {
  const build = runCapture("npm", ["--prefix", "web", "run", "build"], { env, cwd: repoRoot });
  const stdout = String(build.stdout || "");
  const stderr = String(build.stderr || "");
  const combined = `${stdout}\n${stderr}`;
  const failureSignature = detectFirebaseApiKeyFailureSignature(combined);
  if (build.status !== 0) {
    return {
      ok: false,
      code: "hosting_build_failed",
      status: build.status ?? 1,
      stdout,
      stderr,
      failureSignature,
    };
  }

  const artifactCheck = inspectFirebaseBuildArtifactsFromDist(resolve(repoRoot, "web", "dist"));
  if (!artifactCheck.ok) {
    return {
      ok: false,
      code: artifactCheck.code,
      status: 1,
      stdout,
      stderr,
      artifactCheck,
      failureSignature: failureSignature ?? detectFirebaseApiKeyFailureSignature(artifactCheck.message),
    };
  }

  return {
    ok: true,
    code: "hosting_build_guard_passed",
    status: 0,
    stdout,
    stderr,
    artifactCheck,
  };
}

function runFirebaseDeploy({ project, only, nonInteractive, env }) {
  const args = ["firebase-tools", "deploy", "--project", project];
  if (only) args.push("--only", only);
  if (nonInteractive) args.push("--non-interactive");
  return spawnSync("npx", args, {
    encoding: "utf8",
    stdio: "pipe",
    env: env || process.env,
    cwd: repoRoot,
  });
}

async function deployWithRetries({ project, only, nonInteractive, quotaRetries, cooldownSeconds, label, env }) {
  let attempt = 0;
  while (attempt <= quotaRetries) {
    attempt += 1;
    const startedAt = Date.now();
    const result = runFirebaseDeploy({ project, only, nonInteractive, env });
    const durationMs = Date.now() - startedAt;
    const stdout = String(result.stdout || "");
    const stderr = String(result.stderr || "");
    const combined = `${stdout}\n${stderr}`;

    if (result.status === 0) {
      return {
        ok: true,
        label,
        only,
        attempt,
        durationMs,
        status: result.status,
        stdout,
        stderr,
      };
    }

    const quota = isQuotaError(combined);
    const failureSignature = detectFirebaseApiKeyFailureSignature(combined);
    if (!quota || attempt > quotaRetries) {
      return {
        ok: false,
        label,
        only,
        attempt,
        durationMs,
        status: result.status,
        stdout,
        stderr,
        quotaError: quota,
        failureSignature,
      };
    }

    process.stdout.write(
      `[deploy-safe] quota throttle detected for ${label}; retrying in ${cooldownSeconds}s (attempt ${attempt}/${quotaRetries + 1})\n`
    );
    await sleep(cooldownSeconds * 1000);
  }

  return {
    ok: false,
    label,
    only,
    attempt: quotaRetries + 1,
    durationMs: 0,
    status: 1,
    stdout: "",
    stderr: "Retry loop exhausted.",
    quotaError: true,
    failureSignature: null,
  };
}

function emitSummaryAndExit({ summary, asJson, code }) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else if (summary?.message) {
    process.stderr.write(`[deploy-safe] ${summary.message}\n`);
  }
  process.exit(code);
}

async function main() {
  loadPortalAutomationEnv();

  const options = parseArgs(process.argv.slice(2));
  const functions = parseFunctions(options.functionsRaw);
  const steps = [];
  const runStartedAtIso = new Date().toISOString();

  const deployHosting = options.target === "hosting" || options.target === "functions-hosting";
  const deployFunctions = options.target === "functions" || options.target === "functions-hosting";

  if (deployFunctions && functions.length === 0 && !options.allowBroadFunctions) {
    const message =
      "Blocked broad production functions deploy. Use --functions <fn1,fn2> for staged waves, or explicitly pass --allow-broad-functions.";
    const summary = {
      status: "blocked",
      project: options.project,
      target: options.target,
      message,
      runStartedAtIso,
      runFinishedAtIso: new Date().toISOString(),
      steps,
    };
    if (!options.asJson) {
      process.stderr.write(
        "[deploy-safe] Example: npm run deploy:functions -- --functions apiV1,importLibraryIsbns,runLibraryOverdueSyncNow\n"
      );
    }
    emitSummaryAndExit({ summary, asJson: options.asJson, code: 2 });
  }

  let deployEnv = process.env;

  if (deployHosting) {
    const keyResolution = resolveFirebaseWebApiKey({ project: options.project, env: process.env, cwd: repoRoot });
    steps.push({
      label: "hosting firebase api key resolution",
      ok: keyResolution.ok,
      source: keyResolution.ok ? keyResolution.source : null,
      keySummary: keyResolution.ok ? keyResolution.keySummary : null,
      attempts: keyResolution.attempts,
      sdkconfig: keyResolution.ok ? null : keyResolution.sdkconfig ?? null,
    });

    if (!keyResolution.ok) {
      const message =
        "Blocked hosting deploy: unable to resolve a valid Firebase Web API key. This would ship a broken auth bootstrap (`MISSING_VITE_FIREBASE_API_KEY`).";
      const summary = {
        status: "blocked",
        project: options.project,
        target: options.target,
        message,
        details: keyResolution,
        runStartedAtIso,
        runFinishedAtIso: new Date().toISOString(),
        steps,
      };
      emitSummaryAndExit({ summary, asJson: options.asJson, code: 2 });
    }

    deployEnv = {
      ...process.env,
      VITE_FIREBASE_API_KEY: keyResolution.key,
    };

    process.stdout.write("[deploy-safe] running hosting Firebase API key build guard\n");
    const hostingBuildGuard = runHostingBuildGuard({ env: deployEnv });
    steps.push({
      label: "hosting firebase api key build guard",
      ok: hostingBuildGuard.ok,
      code: hostingBuildGuard.code,
      failureSignature: hostingBuildGuard.failureSignature ?? null,
      artifactCheck: hostingBuildGuard.artifactCheck ?? null,
      status: hostingBuildGuard.status,
    });

    if (!hostingBuildGuard.ok) {
      const message =
        "Blocked hosting deploy: Firebase API key guard failed. Build output is not safe for production auth flows.";
      const summary = {
        status: "blocked",
        project: options.project,
        target: options.target,
        message,
        runStartedAtIso,
        runFinishedAtIso: new Date().toISOString(),
        steps,
      };
      if (!options.asJson) {
        const output = `${hostingBuildGuard.stderr || ""}\n${hostingBuildGuard.stdout || ""}`;
        const signature = hostingBuildGuard.failureSignature ?? detectFirebaseApiKeyFailureSignature(output);
        if (signature) {
          process.stderr.write(`[deploy-safe] detected failure signature: ${signature.code} (${signature.message})\n`);
        }
      }
      emitSummaryAndExit({ summary, asJson: options.asJson, code: 2 });
    }

    process.stdout.write("[deploy-safe] deploying hosting\n");
    const hostingStep = await deployWithRetries({
      project: options.project,
      only: "hosting",
      nonInteractive: options.nonInteractive,
      quotaRetries: 0,
      cooldownSeconds: options.cooldownSeconds,
      label: "hosting",
      env: deployEnv,
    });
    steps.push(hostingStep);
    if (!hostingStep.ok) {
      const summary = {
        status: "failed",
        project: options.project,
        target: options.target,
        runStartedAtIso,
        runFinishedAtIso: new Date().toISOString(),
        steps,
      };
      if (options.asJson) {
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
      } else {
        if (hostingStep.failureSignature) {
          process.stderr.write(
            `[deploy-safe] detected failure signature: ${hostingStep.failureSignature.code} (${hostingStep.failureSignature.message})\n`
          );
        }
        process.stderr.write(hostingStep.stderr || hostingStep.stdout || "hosting deploy failed\n");
      }
      process.exit(1);
    }
  }

  if (deployFunctions) {
    if (functions.length === 0 && options.allowBroadFunctions) {
      process.stdout.write("[deploy-safe] deploying broad functions set (override enabled)\n");
      const broadStep = await deployWithRetries({
        project: options.project,
        only: "functions",
        nonInteractive: options.nonInteractive,
        quotaRetries: options.quotaRetries,
        cooldownSeconds: options.cooldownSeconds,
        label: "functions (broad)",
        env: process.env,
      });
      steps.push(broadStep);
      if (!broadStep.ok) {
        const summary = {
          status: "failed",
          project: options.project,
          target: options.target,
          runStartedAtIso,
          runFinishedAtIso: new Date().toISOString(),
          steps,
        };
        if (options.asJson) {
          process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
        } else {
          process.stderr.write(broadStep.stderr || broadStep.stdout || "functions deploy failed\n");
        }
        process.exit(1);
      }
    } else {
      const quotaSensitive = [];
      const normal = [];
      for (const fn of functions) {
        if (QUOTA_SENSITIVE_FUNCTIONS.has(fn)) quotaSensitive.push(fn);
        else normal.push(fn);
      }

      const waves = [
        ...chunk(normal, options.waveSize),
        ...quotaSensitive.map((fn) => [fn]),
      ];

      for (let index = 0; index < waves.length; index += 1) {
        const wave = waves[index];
        const only = wave.map((fn) => `functions:${fn}`).join(",");
        const label = `functions wave ${index + 1}/${waves.length}: ${wave.join(",")}`;
        process.stdout.write(`[deploy-safe] deploying ${label}\n`);
        const step = await deployWithRetries({
          project: options.project,
          only,
          nonInteractive: options.nonInteractive,
          quotaRetries: options.quotaRetries,
          cooldownSeconds: options.cooldownSeconds,
          label,
          env: process.env,
        });
        steps.push(step);
        if (!step.ok) {
          const summary = {
            status: "failed",
            project: options.project,
            target: options.target,
            runStartedAtIso,
            runFinishedAtIso: new Date().toISOString(),
            steps,
          };
          if (options.asJson) {
            process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
          } else {
            process.stderr.write(step.stderr || step.stdout || "functions deploy failed\n");
          }
          process.exit(1);
        }

        if (index < waves.length - 1 && options.cooldownSeconds > 0) {
          process.stdout.write(`[deploy-safe] cooldown ${options.cooldownSeconds}s before next wave\n`);
          await sleep(options.cooldownSeconds * 1000);
        }
      }
    }
  }

  const summary = {
    status: "passed",
    project: options.project,
    target: options.target,
    functions: functions.length > 0 ? functions : null,
    runStartedAtIso,
    runFinishedAtIso: new Date().toISOString(),
    steps,
  };

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write("[deploy-safe] deployment completed\n");
  }
}

export {
  detectFirebaseApiKeyFailureSignature,
  inspectFirebaseBuildArtifacts,
  isQuotaError,
  looksLikeFirebaseApiKey,
  parseArgs,
  parseFunctions,
  parseJsonObjectFromMixedOutput,
  resolveFirebaseWebApiKey,
};

const invokedAsScript =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`deploy-firebase-safe failed: ${message}`);
    process.exit(1);
  });
}
