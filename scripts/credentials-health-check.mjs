#!/usr/bin/env node

/* eslint-disable no-console */

import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildAutomationFamilyBody, getAutomationFamily } from "./lib/automation-issue-families.mjs";
import { mintStaffIdTokenFromPortalEnv, resolvePortalAgentStaffCredentials } from "./lib/firebase-auth-token.mjs";
import {
  ensureGhLabels,
  ensureIssueWithMarker,
  fetchLatestIssueCommentBody,
  listRepoIssues,
} from "./lib/github-issues.mjs";
import { loadPortalAutomationEnv } from "./lib/runtime-secrets.mjs";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "credential-health-check.json");
const PORTAL_INFRA_FAMILY = getAutomationFamily("portal-infra");
const GOOGLE_OAUTH_TOKEN_ENDPOINT = "https://www.googleapis.com/oauth2/v3/token";
const FIREBASE_CLI_OAUTH_CLIENT_ID =
  "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const FIREBASE_CLI_OAUTH_CLIENT_SECRET = String(process.env.FIREBASE_CLI_OAUTH_CLIENT_SECRET || "").trim();
loadPortalAutomationEnv();

function parseBoolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseArgs(argv) {
  const options = {
    projectId: String(process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
    baseUrl: String(process.env.PORTAL_CANARY_BASE_URL || DEFAULT_BASE_URL).trim(),
    apiKey: String(process.env.PORTAL_FIREBASE_API_KEY || "").trim(),
    asJson: false,
    apply: true,
    includeGithub: true,
    reportPath: DEFAULT_REPORT_PATH,
    timeoutMs: 15000,
    rulesProbeRequired: parseBoolEnv(process.env.CREDENTIAL_HEALTH_RULES_PROBE_REQUIRED, true),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
    if (arg === "--apply") {
      options.apply = true;
      continue;
    }
    if (arg === "--no-apply") {
      options.apply = false;
      continue;
    }
    if (arg === "--no-github") {
      options.includeGithub = false;
      continue;
    }
    if (arg === "--rules-probe-required") {
      options.rulesProbeRequired = true;
      continue;
    }
    if (arg === "--rules-probe-optional" || arg === "--no-rules-probe-required") {
      options.rulesProbeRequired = false;
      continue;
    }
    if (arg.startsWith("--rules-probe-required=")) {
      const raw = String(arg.slice("--rules-probe-required=".length)).trim().toLowerCase();
      options.rulesProbeRequired = raw === "1" || raw === "true" || raw === "yes" || raw === "on";
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--project") {
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--api-key") {
      options.apiKey = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--timeout-ms") {
      const value = Number(next);
      if (!Number.isFinite(value) || value < 1000) throw new Error("--timeout-ms must be >= 1000");
      options.timeoutMs = Math.floor(value);
      index += 1;
      continue;
    }
  }

  return options;
}

function runCommand(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: "utf8" });
  const code = typeof result.status === "number" ? result.status : 1;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (!allowFailure && code !== 0) {
    throw new Error(`Command failed (${code}): ${command} ${args.join(" ")}\n${stderr || stdout}`);
  }
  return {
    ok: code === 0,
    code,
    stdout,
    stderr,
  };
}

function parseRepoSlug() {
  const envSlug = String(process.env.GITHUB_REPOSITORY || "").trim();
  if (envSlug) return envSlug;

  const remote = runCommand("git", ["config", "--get", "remote.origin.url"], { allowFailure: true });
  if (!remote.ok) return "";

  const value = remote.stdout.trim();
  const sshMatch = value.match(/^git@github\.com:([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (sshMatch) return sshMatch[1];
  const httpsMatch = value.match(/^https:\/\/github\.com\/([^/]+\/[^/.]+)(?:\.git)?$/i);
  if (httpsMatch) return httpsMatch[1];
  return "";
}

function postIssueComment(repoSlug, issueNumber, body) {
  runCommand(
    "gh",
    ["issue", "comment", String(issueNumber), "--repo", repoSlug, "--body", body],
    { allowFailure: true }
  );
}

function stableHash(value, len = 20) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, len);
}

function buildSummarySignature(summary) {
  const shape = {
    status: String(summary?.status || ""),
    projectId: String(summary?.projectId || ""),
    baseUrl: String(summary?.baseUrl || ""),
    checks: Array.isArray(summary?.checks)
      ? summary.checks.map((item) => ({
          label: String(item?.label || ""),
          status: String(item?.status || ""),
          required: item?.required !== false,
        }))
      : [],
    probes: Array.isArray(summary?.probes)
      ? summary.probes.map((item) => ({
          label: String(item?.label || ""),
          status: String(item?.status || ""),
          required: item?.required !== false,
        }))
      : [],
  };
  return stableHash(JSON.stringify(shape), 20);
}

async function requestJson(url, init = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        ...(init.headers || {}),
      },
    });

    const text = await response.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text.slice(0, 600) };
    }

    return {
      ok: response.ok,
      status: response.status,
      json: parsed,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      json: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function summarizeError(response) {
  if (response.ok) return "";
  const message =
    String(
      response.json?.error?.message ||
        response.json?.message ||
        response.json?.raw ||
        "request failed"
    ).trim();
  return message || "request failed";
}

function decodeJwtExp(token) {
  try {
    const parts = String(token || "").split(".");
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    const exp = Number(payload?.exp);
    if (!Number.isFinite(exp)) return null;
    return new Date(exp * 1000).toISOString();
  } catch {
    return null;
  }
}

function looksLikeRefreshToken(token) {
  return String(token || "").startsWith("1//");
}

async function loadFirebaseCliTokens() {
  const configPath = resolve(homedir(), ".config", "configstore", "firebase-tools.json");
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const accessToken = String(parsed?.tokens?.access_token || "").trim();
  const refreshToken = String(parsed?.tokens?.refresh_token || "").trim();
  return {
    configPath,
    accessToken,
    refreshToken,
  };
}

async function exchangeRefreshToken(refreshToken, source) {
  const form = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: FIREBASE_CLI_OAUTH_CLIENT_ID,
    grant_type: "refresh_token",
  });
  if (FIREBASE_CLI_OAUTH_CLIENT_SECRET) {
    form.set("client_secret", FIREBASE_CLI_OAUTH_CLIENT_SECRET);
  }

  const response = await fetch(GOOGLE_OAUTH_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text.slice(0, 600) };
  }

  if (!response.ok || typeof parsed?.access_token !== "string") {
    const message =
      String(parsed?.error_description || parsed?.error || parsed?.message || "").trim() ||
      "token exchange failed";
    throw new Error(`Unable to exchange rules token (${source}): ${message}`);
  }

  return String(parsed.access_token).trim();
}

async function resolveRulesApiToken() {
  const envToken = String(process.env.FIREBASE_RULES_API_TOKEN || "").trim();
  let envRefreshError = null;

  if (envToken) {
    if (looksLikeRefreshToken(envToken)) {
      try {
        return {
          source: "env_refresh_token",
          token: await exchangeRefreshToken(envToken, "env_refresh_token"),
        };
      } catch (error) {
        envRefreshError = error instanceof Error ? error : new Error(String(error));
      }
    } else {
      return {
        source: "env_access_token",
        token: envToken,
      };
    }
  }

  try {
    const cli = await loadFirebaseCliTokens();
    if (cli.accessToken) {
      return {
        source: "firebase_tools_access_token",
        token: cli.accessToken,
      };
    }
    if (cli.refreshToken) {
      return {
        source: "firebase_tools_refresh_token",
        token: await exchangeRefreshToken(cli.refreshToken, "firebase_tools_refresh_token"),
      };
    }
  } catch {
    // Ignore configstore read failures and continue to consolidated error below.
  }

  if (envRefreshError) {
    throw envRefreshError;
  }
  throw new Error("FIREBASE_RULES_API_TOKEN is missing, and firebase-tools token cache has no usable token.");
}

function addCheck(summary, label, ok, detail, required = true) {
  summary.checks.push({
    label,
    status: ok ? "passed" : "failed",
    required,
    detail,
  });
}

async function resolveAgentCredentialSource(summary, env) {
  const credsJsonEnv = String(env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON || "").trim();
  const credsPathEnv = String(env.PORTAL_AGENT_STAFF_CREDENTIALS || "").trim();

  if (credsJsonEnv) {
    try {
      const parsed = resolvePortalAgentStaffCredentials({ env, credentialsJson: credsJsonEnv });
      const refreshToken = String(parsed?.refreshToken || "").trim();
      const uid = String(parsed?.uid || "").trim();
      const email = String(parsed?.email || "").trim();
      const ok = Boolean(refreshToken && uid && email);
      addCheck(
        summary,
        "agent credentials payload is valid JSON",
        ok,
        ok ? "PORTAL_AGENT_STAFF_CREDENTIALS_JSON parsed." : "Missing refreshToken/uid/email."
      );
      return ok ? { ...parsed, source: "env_json" } : null;
    } catch (error) {
      addCheck(
        summary,
        "agent credentials payload is valid JSON",
        false,
        `PORTAL_AGENT_STAFF_CREDENTIALS_JSON parse failed (${error instanceof Error ? error.message : String(error)}).`
      );
      return null;
    }
  }

  if (credsPathEnv) {
    const path = resolve(process.cwd(), credsPathEnv);
    const exists = existsSync(path);
    addCheck(summary, "agent credentials path exists", exists, exists ? path : `Missing file: ${path}`);
    if (!exists) return null;

    const parsed = resolvePortalAgentStaffCredentials({ env, credentialsPath: path });
    const ok = Boolean(parsed?.refreshToken && parsed?.uid && parsed?.email);
    addCheck(summary, "agent credentials file content is valid", ok, ok ? "Credential file parsed." : "Missing refreshToken/uid/email.");
    return ok ? { ...parsed, source: `file:${path}` } : null;
  }

  addCheck(summary, "agent credentials source is configured", false, "Set PORTAL_AGENT_STAFF_CREDENTIALS_JSON or PORTAL_AGENT_STAFF_CREDENTIALS.");
  return null;
}

function buildIssueComment(summary, signatureMarker = "") {
  const lines = [];
  lines.push(`## ${summary.timestampIso} — credential health`);
  lines.push("");
  lines.push(`- Status: ${summary.status}`);
  lines.push(`- Project: ${summary.projectId}`);
  lines.push(`- Base URL: ${summary.baseUrl}`);
  lines.push("");
  lines.push("### Checks");
  for (const check of summary.checks) {
    lines.push(`- ${check.label}: ${check.status}${check.detail ? ` (${check.detail})` : ""}`);
  }
  lines.push("");
  lines.push("### Probes");
  for (const probe of summary.probes) {
    const requiredSuffix = probe.required === false ? " (optional)" : "";
    const displayStatus = probe.required === false && probe.status === "failed" ? "warn" : probe.status;
    lines.push(`- ${probe.label}${requiredSuffix}: ${displayStatus}${probe.detail ? ` (${probe.detail})` : ""}`);
  }
  lines.push("");
  if (summary.runUrl) {
    lines.push(`- Run: ${summary.runUrl}`);
  }
  if (signatureMarker) {
    lines.push("");
    lines.push(signatureMarker);
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runtimeEnv = { ...process.env };
  if (options.apiKey) {
    runtimeEnv.PORTAL_FIREBASE_API_KEY = options.apiKey;
  }

  const summary = {
    status: "passed",
    timestampIso: new Date().toISOString(),
    projectId: options.projectId,
    baseUrl: options.baseUrl,
    checks: [],
    probes: [],
    reportPath: options.reportPath,
    runUrl: process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : "",
    rollingIssue: {
      number: 0,
      url: "",
    },
  };

  let rulesTokenResolution = null;
  let rulesTokenError = "";
  try {
    rulesTokenResolution = await resolveRulesApiToken();
  } catch (error) {
    rulesTokenError = error instanceof Error ? error.message : String(error);
  }

  const agentCreds = await resolveAgentCredentialSource(summary, runtimeEnv);
  const staffEmail = String(runtimeEnv.PORTAL_STAFF_EMAIL || "").trim() || String(agentCreds?.email || "").trim();
  const staffPassword = String(runtimeEnv.PORTAL_STAFF_PASSWORD || "").trim() || String(agentCreds?.password || "").trim();

  addCheck(summary, "staff email is configured", staffEmail.length > 0, staffEmail ? "Staff email resolved." : "No staff email found in env or agent credential source.");
  addCheck(
    summary,
    "staff password fallback is configured",
    staffPassword.length > 0,
    staffPassword ? "Optional password fallback is available." : "Password fallback is not configured; refresh-token auth is expected.",
    false
  );
  addCheck(
    summary,
    "rules API token is configured",
    Boolean(rulesTokenResolution?.token),
    rulesTokenResolution?.token
      ? `Rules API token resolved (${rulesTokenResolution.source}).`
      : rulesTokenError || "FIREBASE_RULES_API_TOKEN missing.",
    options.rulesProbeRequired
  );
  addCheck(summary, "Firebase Web API key is configured", options.apiKey.length > 0, options.apiKey ? "PORTAL_FIREBASE_API_KEY detected." : "PORTAL_FIREBASE_API_KEY missing.");
  const mintedStaffToken = await mintStaffIdTokenFromPortalEnv({ env: runtimeEnv });
  const staffExpIso = mintedStaffToken.ok ? decodeJwtExp(mintedStaffToken.token) : null;
  summary.probes.push({
    label: "staff auth token mint",
    required: true,
    status: mintedStaffToken.ok ? "passed" : "failed",
    detail: mintedStaffToken.ok
      ? `Firebase staff token minted via ${mintedStaffToken.source}${staffExpIso ? ` (exp ${staffExpIso})` : ""}.`
      : `Could not mint Firebase staff token: ${mintedStaffToken.reason}`,
  });

  if (staffEmail && staffPassword && options.apiKey) {
    const signinResp = await requestJson(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(options.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: staffEmail,
          password: staffPassword,
          returnSecureToken: true,
        }),
      },
      options.timeoutMs
    );

    const idToken = String(signinResp.json?.idToken || "").trim();
    const expIso = idToken ? decodeJwtExp(idToken) : null;
    summary.probes.push({
      label: "staff password fallback sign-in",
      required: false,
      status: signinResp.ok && idToken ? "passed" : "failed",
      detail: signinResp.ok && idToken
        ? `Password fallback is still valid${expIso ? ` (exp ${expIso})` : ""}.`
        : `Password fallback failed: ${summarizeError(signinResp)}`,
    });
  } else {
    summary.probes.push({
      label: "staff password fallback sign-in",
      required: false,
      status: "failed",
      detail: "Skipped because no password fallback is configured.",
    });
  }

  if (agentCreds && options.apiKey) {
    const tokenResp = await requestJson(
      `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(options.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: agentCreds.refreshToken,
        }).toString(),
      },
      options.timeoutMs
    );

    const idToken = String(tokenResp.json?.id_token || "").trim();
    const expIso = idToken ? decodeJwtExp(idToken) : null;
    summary.probes.push({
      label: "agent refresh-token exchange",
      required: true,
      status: tokenResp.ok && idToken ? "passed" : "failed",
      detail: tokenResp.ok && idToken
        ? `Refresh token exchange succeeded${expIso ? ` (exp ${expIso})` : ""}.`
        : `Refresh token exchange failed: ${summarizeError(tokenResp)}`,
    });
  } else {
    summary.probes.push({
      label: "agent refresh-token exchange",
      required: true,
      status: "failed",
      detail: "Skipped probe because agent credentials or API key are missing.",
    });
  }

  if (rulesTokenResolution?.token) {
    const rulesResp = await requestJson(
      `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(options.projectId)}/releases/cloud.firestore/default`,
      {
        headers: {
          authorization: `Bearer ${rulesTokenResolution.token}`,
        },
      },
      options.timeoutMs
    );

    summary.probes.push({
      label: "rules API token probe",
      required: options.rulesProbeRequired,
      status: rulesResp.ok ? "passed" : "failed",
      detail: rulesResp.ok
        ? `Rules API release read succeeded (${rulesTokenResolution.source}).`
        : `Rules API probe failed: ${summarizeError(rulesResp)}`,
    });
  } else {
    summary.probes.push({
      label: "rules API token probe",
      required: options.rulesProbeRequired,
      status: "failed",
      detail: `Skipped probe because rules token is unresolved.${rulesTokenError ? ` ${rulesTokenError}` : ""}`,
    });
  }

  const requiredCheckFailed = summary.checks.some((check) => check.required && check.status === "failed");
  const probeFailed = summary.probes.some((probe) => (probe.required ?? true) && probe.status === "failed");
  summary.status = requiredCheckFailed || probeFailed ? "failed" : "passed";

  if (options.apply && options.includeGithub) {
    const repoSlug = parseRepoSlug();
    if (repoSlug) {
      const openIssuesResp = listRepoIssues(repoSlug, { state: "open", maxPages: 2, cwd: repoRoot });
      if (openIssuesResp.ok) {
        ensureGhLabels(repoSlug, PORTAL_INFRA_FAMILY.labels, { cwd: repoRoot });
        const ensured = ensureIssueWithMarker(
          repoSlug,
          {
            title: PORTAL_INFRA_FAMILY.title,
            body: buildAutomationFamilyBody(PORTAL_INFRA_FAMILY),
            labels: PORTAL_INFRA_FAMILY.labels.map((label) => label.name),
            marker: PORTAL_INFRA_FAMILY.marker,
            preferredNumber: PORTAL_INFRA_FAMILY.preferredNumber,
            openIssues: openIssuesResp.data,
          },
          { cwd: repoRoot }
        );
        if (ensured.ok && ensured.issue) {
          summary.rollingIssue = {
            number: ensured.issue.number,
            url: ensured.issue.url,
            signature: "",
            commentSkipped: false,
          };
        }
      }

      if (summary.rollingIssue.number > 0) {
        const signature = buildSummarySignature(summary);
        const marker = `<!-- credential-health-signature:${signature} -->`;
        const latestBody = fetchLatestIssueCommentBody(repoSlug, summary.rollingIssue.number, { cwd: repoRoot });
        const unchanged = latestBody.includes(marker);
        summary.rollingIssue.signature = signature;
        summary.rollingIssue.commentSkipped = unchanged;
        if (!unchanged) {
          postIssueComment(repoSlug, summary.rollingIssue.number, buildIssueComment(summary, marker));
        }
      }
    }
  }

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`project: ${summary.projectId}\n`);
    for (const check of summary.checks) {
      process.stdout.write(`- ${check.label}: ${check.status}${check.detail ? ` (${check.detail})` : ""}\n`);
    }
    for (const probe of summary.probes) {
      process.stdout.write(`- ${probe.label}: ${probe.status}${probe.detail ? ` (${probe.detail})` : ""}\n`);
    }
    process.stdout.write(`report: ${options.reportPath}\n`);
    if (summary.rollingIssue.url) {
      process.stdout.write(`rolling issue: ${summary.rollingIssue.url}\n`);
    }
  }

  if (summary.status === "failed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`credentials-health-check failed: ${message}`);
  process.exit(1);
});
