#!/usr/bin/env node

/* eslint-disable no-console */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PORTAL_SECRET_PROVIDER_DEFAULT,
  PORTAL_SECRET_SYNC_COMMAND,
  extractOnePasswordLoginCredentials,
  mergePortalAutomationEnv,
  parsePortalAgentStaffPayload,
  resolvePortalSecretSyncOptions,
  resolvePortalSecretProviderConfig,
  validatePortalAgentStaffCredentials,
  validatePortalAutomationEnv,
} from "./lib/portal-automation-secrets.mjs";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), "..");
const HOME_ROOT = homedir();

function fail(message, { cause = "", extra = "" } = {}) {
  const details = [message, cause, extra].map((value) => String(value || "").trim()).filter(Boolean).join(" ");
  throw new Error(details || message);
}

function resolveOpExecutable(env = process.env) {
  if (process.platform !== "win32") {
    return "op";
  }

  const localAppData = String(env.LOCALAPPDATA || "").trim();
  const packageRoot = localAppData ? resolve(localAppData, "Microsoft", "WinGet", "Packages") : "";
  if (!packageRoot || !existsSync(packageRoot)) {
    return "op";
  }

  try {
    const packageDir = readdirSync(packageRoot, { withFileTypes: true })
      .find((entry) => entry.isDirectory() && entry.name.startsWith("AgileBits.1Password.CLI_"));
    if (!packageDir) {
      return "op";
    }

    const opPath = join(packageRoot, packageDir.name, "op.exe");
    return existsSync(opPath) ? opPath : "op";
  } catch {
    return "op";
  }
}

function runOp(args, { optional = false } = {}) {
  const result = spawnSync(resolveOpExecutable(process.env), args, {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    if (optional && result.error.code === "ENOENT") {
      return { ok: false, optional: true, stdout: "", stderr: result.error.message, status: 127 };
    }
    fail(
      "1Password CLI (`op`) is not available. Install the official 1Password CLI and enable desktop app integration first.",
      { cause: result.error.message }
    );
  }

  if (result.status !== 0) {
    if (optional) {
      return {
        ok: false,
        optional: true,
        stdout: String(result.stdout || ""),
        stderr: String(result.stderr || ""),
        status: result.status ?? 1,
      };
    }
    const stderr = String(result.stderr || "").trim();
    const stdout = String(result.stdout || "").trim();
    fail(`1Password CLI command failed: op ${args.join(" ")}`, {
      cause: stderr || stdout,
      extra: "Unlock 1Password Desktop and confirm the dedicated vault/item names are correct.",
    });
  }

  return {
    ok: true,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    status: result.status ?? 0,
  };
}

function readOnePasswordItemJson(vault, item, { optional = false } = {}) {
  const result = runOp(["item", "get", item, "--vault", vault, "--format", "json"], { optional });
  if (!result.ok) return null;
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    if (optional) return null;
    fail(`Could not parse JSON for 1Password item ${item}.`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return null;
}

function extractOnePasswordNotesPlain(itemJson) {
  const topLevelNotes = String(itemJson?.notesPlain || "").trim();
  if (topLevelNotes) {
    return topLevelNotes;
  }

  const fieldNotes = Array.isArray(itemJson?.fields)
    ? itemJson.fields.find((field) => String(field?.id || "").trim() === "notesPlain")
    : null;
  const fieldValue = String(fieldNotes?.value || "").trim();
  return fieldValue;
}

function readOnePasswordItemText(vault, item) {
  const itemJson = readOnePasswordItemJson(vault, item);
  const notesPlain = extractOnePasswordNotesPlain(itemJson);
  if (notesPlain) {
    return { text: notesPlain, source: "notesPlain" };
  }

  const documentResult = runOp(["document", "get", item, "--vault", vault]);
  const documentText = String(documentResult.stdout || "");
  if (documentText.trim()) {
    return { text: documentText, source: "document" };
  }

  fail(`1Password item ${item} did not expose note or document content.`);
}

async function writeFileAtomic(path, content) {
  const targetPath = resolve(path);
  const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(dirname(targetPath), { recursive: true });
  await writeFile(tempPath, content, "utf8");
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

function syncRuntimeMirror({ optional = false } = {}) {
  const nodeExecutable = process.execPath || "node";
  const result = spawnSync(nodeExecutable, ["./scripts/sync-codex-home-runtime.mjs"], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    if (optional) {
      return { ok: false, report: null, stderr: String(result.stderr || result.stdout || "").trim() };
    }
    fail("Runtime secret mirror failed after writing the shared home cache.", {
      cause: String(result.stderr || result.stdout || "").trim(),
    });
  }

  try {
    return {
      ok: true,
      report: JSON.parse(String(result.stdout || "{}")),
      stderr: String(result.stderr || "").trim(),
    };
  } catch (error) {
    if (optional) {
      return { ok: false, report: null, stderr: error instanceof Error ? error.message : String(error) };
    }
    fail("Runtime secret mirror returned non-JSON output.", {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return { ok: false, report: null, stderr: "" };
}

async function main(options) {
  const providerConfig = resolvePortalSecretProviderConfig(process.env);

  if (providerConfig.provider !== PORTAL_SECRET_PROVIDER_DEFAULT) {
    fail(
      `Unsupported PORTAL_SECRET_PROVIDER value: ${providerConfig.provider}. Only ${PORTAL_SECRET_PROVIDER_DEFAULT} is implemented in this pass.`
    );
  }

  runOp(["--version"]);
  runOp(["vault", "get", providerConfig.vault, "--format", "json"]);

  const envItem = readOnePasswordItemText(providerConfig.vault, providerConfig.envItem);
  const agentItem = readOnePasswordItemText(providerConfig.vault, providerConfig.agentStaffItem);
  const passwordItemJson = readOnePasswordItemJson(providerConfig.vault, providerConfig.staffPasswordItem, {
    optional: true,
  });

  const homeEnvPath = resolve(HOME_ROOT, "secrets", "portal", "portal-automation.env");
  const homeAgentPath = resolve(HOME_ROOT, "secrets", "portal", "portal-agent-staff.json");
  const existingEnvText = existsSync(homeEnvPath) ? readFileSync(homeEnvPath, "utf8") : "";
  const mergedEnv = mergePortalAutomationEnv({
    remoteEnvText: envItem.text,
    existingEnvText,
    portalAgentStaffPath: homeAgentPath,
    ...extractOnePasswordLoginCredentials(passwordItemJson),
  });

  const envValidation = validatePortalAutomationEnv(mergedEnv.envValues);
  if (!envValidation.ok) {
    fail(
      `1Password env item ${providerConfig.envItem} is missing required values: ${envValidation.missing.join(", ")}.`
    );
  }

  const agentPayload = parsePortalAgentStaffPayload(agentItem.text);
  const agentValidation = validatePortalAgentStaffCredentials(agentPayload);
  if (!agentPayload || !agentValidation.ok) {
    fail(
      `1Password item ${providerConfig.agentStaffItem} must be valid JSON with email, uid, and refreshToken.`,
      { cause: agentValidation.ok ? "" : `Missing: ${agentValidation.missing.join(", ")}` }
    );
  }

  await writeFileAtomic(homeEnvPath, mergedEnv.envText);
  await writeFileAtomic(homeAgentPath, `${JSON.stringify(agentPayload, null, 2)}\n`);

  const mirrorReport = options.skipRuntimeMirror ? null : syncRuntimeMirror().report;
  const summary = {
    schema: "portal-secrets-sync-report.v1",
    provider: providerConfig.provider,
    vault: providerConfig.vault,
    items: {
      env: providerConfig.envItem,
      agentStaff: providerConfig.agentStaffItem,
      staffPassword: providerConfig.staffPasswordItem,
      staffPasswordPresent: Boolean(extractOnePasswordLoginCredentials(passwordItemJson).password),
    },
    outputs: {
      envPath: homeEnvPath,
      agentStaffPath: homeAgentPath,
      preservedLocalOnlyKeys: mergedEnv.preservedKeys,
    },
    runtimeMirror: mirrorReport,
    nextStep: options.skipRuntimeMirror ? "Run npm run secrets:sync:runtime in the target worktree." : PORTAL_SECRET_SYNC_COMMAND,
  };

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      `Synced portal secrets from 1Password vault "${providerConfig.vault}".`,
      `- env cache: ${homeEnvPath}`,
      `- agent cache: ${homeAgentPath}`,
      mergedEnv.preservedKeys.length > 0
        ? `- preserved local-only keys: ${mergedEnv.preservedKeys.join(", ")}`
        : "- preserved local-only keys: none",
      options.skipRuntimeMirror ? "- skipped worktree mirror" : "- mirrored shared cache into the current worktree runtime bundle",
    ].join("\n") + "\n"
  );
}

const cliOptions = resolvePortalSecretSyncOptions(process.argv.slice(2), process.env);

main(cliOptions).catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (cliOptions.asJson) {
    process.stdout.write(
      `${JSON.stringify(
        {
          schema: "portal-secrets-sync-report.v1",
          status: "failed",
          error: {
            message,
          },
        },
        null,
        2
      )}\n`
    );
  } else {
    process.stderr.write(`${message}\n`);
  }
  process.exit(1);
});
