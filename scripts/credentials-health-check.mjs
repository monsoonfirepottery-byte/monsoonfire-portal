#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_BASE_URL = "https://portal.monsoonfire.com";
const DEFAULT_API_KEY = "AIzaSyC7ynej0nGJas9me9M5oW6jHfLsWe5gHbU";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "credential-health-check.json");
const ROLLING_ISSUE_TITLE = "Portal Credential Health (Rolling)";

function parseBoolEnv(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseArgs(argv) {
  const options = {
    projectId: String(process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
    baseUrl: String(process.env.PORTAL_CANARY_BASE_URL || DEFAULT_BASE_URL).trim(),
    apiKey: String(process.env.PORTAL_FIREBASE_API_KEY || DEFAULT_API_KEY).trim(),
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
    if (arg === "--no-apply") {
      options.apply = false;
      continue;
    }
    if (arg === "--no-github") {
      options.includeGithub = false;
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

function ensureGhLabel(repoSlug, name, color, description) {
  runCommand(
    "gh",
    ["label", "create", name, "--repo", repoSlug, "--color", color, "--description", description, "--force"],
    { allowFailure: true }
  );
}

function ensureRollingIssue(repoSlug) {
  const existing = runCommand(
    "gh",
    [
      "issue",
      "list",
      "--repo",
      repoSlug,
      "--state",
      "open",
      "--search",
      `in:title \"${ROLLING_ISSUE_TITLE}\"`,
      "--json",
      "number,title,url",
    ],
    { allowFailure: true }
  );

  if (existing.ok) {
    try {
      const parsed = JSON.parse(existing.stdout || "[]");
      const match = parsed.find((item) => String(item?.title || "") === ROLLING_ISSUE_TITLE);
      if (match) {
        return {
          number: Number(match.number || 0),
          url: String(match.url || ""),
        };
      }
    } catch {
      // no-op
    }
  }

  const created = runCommand(
    "gh",
    [
      "issue",
      "create",
      "--repo",
      repoSlug,
      "--title",
      ROLLING_ISSUE_TITLE,
      "--body",
      "Rolling credential and secret-health monitor for portal automation.",
      "--label",
      "automation",
      "--label",
      "infra",
      "--label",
      "security",
    ],
    { allowFailure: true }
  );

  if (!created.ok) return { number: 0, url: "" };

  const issueUrl = created.stdout.split(/\s+/).find((token) => token.startsWith("https://github.com/")) || "";
  const issueNumberMatch = issueUrl.match(/\/issues\/(\d+)/);
  return {
    number: issueNumberMatch ? Number(issueNumberMatch[1]) : 0,
    url: issueUrl,
  };
}

function postIssueComment(repoSlug, issueNumber, body) {
  runCommand(
    "gh",
    ["issue", "comment", String(issueNumber), "--repo", repoSlug, "--body", body],
    { allowFailure: true }
  );
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

function addCheck(summary, label, ok, detail, required = true) {
  summary.checks.push({
    label,
    status: ok ? "passed" : "failed",
    required,
    detail,
  });
}

async function resolveAgentCredentialSource(summary) {
  const credsJsonEnv = String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON || "").trim();
  const credsPathEnv = String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS || "").trim();

  if (credsJsonEnv) {
    try {
      const parsed = JSON.parse(credsJsonEnv);
      const refreshToken = String(parsed?.refreshToken || "").trim();
      const uid = String(parsed?.uid || "").trim();
      const email = String(parsed?.email || "").trim();
      const ok = Boolean(refreshToken && uid && email);
      addCheck(summary, "agent credentials payload is valid JSON", ok, ok ? "PORTAL_AGENT_STAFF_CREDENTIALS_JSON parsed." : "Missing refreshToken/uid/email.");
      return ok ? { refreshToken, uid, email, source: "env_json" } : null;
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
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw);
      const refreshToken = String(parsed?.refreshToken || "").trim();
      const uid = String(parsed?.uid || "").trim();
      const email = String(parsed?.email || "").trim();
      const ok = Boolean(refreshToken && uid && email);
      addCheck(summary, "agent credentials file content is valid", ok, ok ? "Credential file parsed." : "Missing refreshToken/uid/email.");
      return ok ? { refreshToken, uid, email, source: `file:${path}` } : null;
    } catch (error) {
      addCheck(summary, "agent credentials file content is valid", false, `Credential file parse failed (${error instanceof Error ? error.message : String(error)}).`);
      return null;
    }
  }

  addCheck(
    summary,
    "agent credentials source is configured",
    false,
    "Set PORTAL_AGENT_STAFF_CREDENTIALS_JSON or PORTAL_AGENT_STAFF_CREDENTIALS."
  );
  return null;
}

function buildIssueComment(summary) {
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
    lines.push(`- ${probe.label}${requiredSuffix}: ${probe.status}${probe.detail ? ` (${probe.detail})` : ""}`);
  }
  lines.push("");
  if (summary.runUrl) {
    lines.push(`- Run: ${summary.runUrl}`);
  }
  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

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

  const staffEmail = String(process.env.PORTAL_STAFF_EMAIL || "").trim();
  const staffPassword = String(process.env.PORTAL_STAFF_PASSWORD || "").trim();
  const rulesToken = String(process.env.FIREBASE_RULES_API_TOKEN || "").trim();

  addCheck(summary, "staff email is configured", staffEmail.length > 0, staffEmail ? "PORTAL_STAFF_EMAIL detected." : "PORTAL_STAFF_EMAIL missing.");
  addCheck(summary, "staff password is configured", staffPassword.length > 0, staffPassword ? "PORTAL_STAFF_PASSWORD detected." : "PORTAL_STAFF_PASSWORD missing.");
  addCheck(summary, "rules API token is configured", rulesToken.length > 0, rulesToken ? "FIREBASE_RULES_API_TOKEN detected." : "FIREBASE_RULES_API_TOKEN missing.");
  addCheck(summary, "Firebase Web API key is resolved", options.apiKey.length > 0, options.apiKey ? "PORTAL_FIREBASE_API_KEY resolved." : "PORTAL_FIREBASE_API_KEY missing.", false);

  const agentCreds = await resolveAgentCredentialSource(summary);

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
      label: "staff email/password sign-in",
      required: true,
      status: signinResp.ok && idToken ? "passed" : "failed",
      detail: signinResp.ok && idToken
        ? `Sign-in token minted${expIso ? ` (exp ${expIso})` : ""}.`
        : `Sign-in failed: ${summarizeError(signinResp)}`,
    });
  } else {
    summary.probes.push({
      label: "staff email/password sign-in",
      required: true,
      status: "failed",
      detail: "Skipped probe because staff credentials or API key are missing.",
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

  if (rulesToken) {
    const rulesResp = await requestJson(
      `https://firebaserules.googleapis.com/v1/projects/${encodeURIComponent(options.projectId)}/releases/cloud.firestore/default`,
      {
        headers: {
          authorization: `Bearer ${rulesToken}`,
        },
      },
      options.timeoutMs
    );

    summary.probes.push({
      label: "rules API token probe",
      required: options.rulesProbeRequired,
      status: rulesResp.ok ? "passed" : "failed",
      detail: rulesResp.ok
        ? "Rules API release read succeeded."
        : `Rules API probe failed: ${summarizeError(rulesResp)}`,
    });
  } else {
    summary.probes.push({
      label: "rules API token probe",
      required: options.rulesProbeRequired,
      status: "failed",
      detail: "Skipped probe because FIREBASE_RULES_API_TOKEN is missing.",
    });
  }

  const requiredCheckFailed = summary.checks.some((check) => check.required && check.status === "failed");
  const probeFailed = summary.probes.some((probe) => (probe.required ?? true) && probe.status === "failed");
  summary.status = requiredCheckFailed || probeFailed ? "failed" : "passed";

  if (options.apply && options.includeGithub) {
    const repoSlug = parseRepoSlug();
    if (repoSlug) {
      ensureGhLabel(repoSlug, "automation", "0e8a16", "Automated monitoring and remediation.");
      ensureGhLabel(repoSlug, "infra", "5319e7", "Infrastructure and operational controls.");
      ensureGhLabel(repoSlug, "security", "d73a4a", "Security and credential hygiene.");

      const rollingIssue = ensureRollingIssue(repoSlug);
      summary.rollingIssue = rollingIssue;
      if (rollingIssue.number > 0) {
        postIssueComment(repoSlug, rollingIssue.number, buildIssueComment(summary));
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
