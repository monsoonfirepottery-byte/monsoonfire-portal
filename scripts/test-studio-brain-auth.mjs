#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { setTimeout as setAbortTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { loadCodexAutomationEnv } from "./lib/codex-automation-env.mjs";
import { hydrateStudioBrainAuthFromPortal } from "./lib/studio-brain-startup-auth.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";
import {
  buildArtifactProvenance,
  DATA_CLASSIFICATIONS,
  normalizePostureMode,
  POSTURE_MODES,
  REDACTION_STATES,
} from "./lib/studiobrain-posture-policy.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const parseArgs = () => {
  const parsed = {
    json: false,
    mode: POSTURE_MODES.LOCAL_ADVISORY,
  };
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const keyValue = arg.slice(2);
    let key = keyValue;
    let value = "true";

    if (keyValue.includes("=")) {
      const [rawKey, ...rest] = keyValue.split("=");
      key = rawKey;
      value = rest.join("=");
    } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
      value = args[i + 1];
      i += 1;
    }

    parsed[key.replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = value;
  }

  parsed.json = parsed.json === true || parsed.json === "true" || parsed.json === "1";
  parsed.promptForToken =
    parsed.promptForToken === true || parsed.promptForToken === "true" || parsed.promptForToken === "1";
  parsed.approvedRemoteRunner =
    parsed.approvedRemoteRunner === true ||
    parsed.approvedRemoteRunner === "true" ||
    parsed.approvedRemoteRunner === "1";
  parsed.mode = normalizePostureMode(parsed.mode, POSTURE_MODES.LOCAL_ADVISORY);
  return parsed;
};

const preview = (value, max = 220) => {
  if (!value) {
    return "";
  }
  const singleLine = String(value).replace(/\r/g, "").replace(/\n/g, " ").trim();
  if (singleLine.length <= max) {
    return singleLine;
  }
  return `${singleLine.slice(0, max)}...`;
};

const redactToken = (token) => {
  if (!token) {
    return "<empty>";
  }
  const trimmed = String(token).trim();
  const prefix = trimmed.length <= 12 ? trimmed : trimmed.slice(0, 12);
  return `${prefix}... (len=${trimmed.length})`;
};

const probe = async (label, url, headers = {}) => {
  const controller = new AbortController();
  const timer = setAbortTimeout(() => {
    controller.abort();
  }, 15000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const body = await response.text();
    return {
      label,
      url,
      statusCode: response.status,
      body,
      error: null,
    };
  } catch (error) {
    clearTimeout(timer);
    return {
      label,
      url,
      statusCode: 0,
      body: "",
      error: error?.message || String(error),
    };
  }
};

const promptToken = async () => {
  const readline = createInterface({ input, output });
  const token = await new Promise((resolve) => {
    readline.question("Enter Firebase ID token for Authorization header: ", (value) => {
      readline.close();
      resolve(value.trim());
    });
  });
  return token;
};

const findWorkingPath = async (baseUrl, preferredPath, fallbackPaths = []) => {
  const candidates = [preferredPath, ...fallbackPaths].filter(
    (value, index, array) => array.indexOf(value) === index,
  );

  for (const path of candidates) {
    const probeResult = await probe(`path-probe:${path}`, `${baseUrl}${path}`, {});
    if (probeResult.statusCode !== 404) {
      return {
        path,
        statusCode: probeResult.statusCode,
      };
    }
  }

  return {
    path: preferredPath,
    statusCode: 404,
  };
};

function isAnonymousRejected(result) {
  const body = String(result.body || "").toLowerCase();
  return [401, 403].includes(result.statusCode) || body.includes("missing authorization header");
}

function isBearerAccepted(result) {
  const body = String(result.body || "").toLowerCase();
  return result.statusCode === 200 || !body.includes("missing authorization header");
}

function isBearerDenied(result) {
  const body = String(result.body || "").toLowerCase();
  return result.statusCode === 401 || result.statusCode === 403 || body.includes("invalid studio-brain admin token");
}

function summarizeCase(result, expectation) {
  if (result.statusCode === -1) {
    return {
      ...result,
      status: "skip",
      ok: false,
      expectation,
    };
  }

  const ok =
    expectation === "reject"
      ? isAnonymousRejected(result)
      : expectation === "allow"
        ? isBearerAccepted(result)
        : expectation === "deny"
          ? isBearerDenied(result)
          : false;

  return {
    ...result,
    status: ok ? "pass" : "fail",
    ok,
    expectation,
  };
}

function printHumanSummary(report) {
  process.stdout.write(`Studio Brain auth probe target: ${report.baseUrl}\n`);
  process.stdout.write(`Mode: ${report.provenance.mode}\n`);
  process.stdout.write(`ID token source: ${report.tokens.idToken}\n`);
  process.stdout.write(`Admin token source: ${report.tokens.adminToken}\n`);
  process.stdout.write(`\nOverall: ${report.status.toUpperCase()}\n`);
  for (const surface of report.surfaces) {
    process.stdout.write(`- ${surface.name} (${surface.path})\n`);
    for (const item of surface.cases) {
      process.stdout.write(`  - ${item.label}: status=${item.statusCode} expected=${item.expectation} result=${item.status}\n`);
      if (item.error) {
        process.stdout.write(`    error=${preview(item.error, 180)}\n`);
      }
      if (item.body) {
        process.stdout.write(`    body=${preview(item.body, 220)}\n`);
      }
    }
  }
}

const run = async () => {
  const options = parseArgs();
  loadCodexAutomationEnv({ repoRoot: REPO_ROOT, env: process.env });
  if (!String(options.idToken || "").trim()) {
    await hydrateStudioBrainAuthFromPortal({ repoRoot: REPO_ROOT, env: process.env }).catch(() => null);
  }
  const explicitOptionBaseUrl = String(options.baseUrl || options.baseURL || "").trim();
  const baseUrl =
    resolveStudioBrainBaseUrlFromEnv({
      env: {
        ...process.env,
        ...(explicitOptionBaseUrl ? { STUDIO_BRAIN_BASE_URL: explicitOptionBaseUrl } : {}),
      },
    }).replace(/\/$/, "");
  const capabilitiesPath = options.capabilitiesPath || "/api/capabilities";
  const connectorPath = options.connectorPath || "/api/connectors/health";
  let idToken = (
    options.idToken ||
    process.env.STUDIO_BRAIN_ID_TOKEN ||
    process.env.STUDIO_BRAIN_AUTH_TOKEN ||
    process.env.STUDIO_BRAIN_MCP_ID_TOKEN ||
    ""
  ).trim();
  const adminToken = (
    options.adminToken ||
    process.env.STUDIO_BRAIN_ADMIN_TOKEN ||
    process.env.STUDIO_BRAIN_MCP_ADMIN_TOKEN ||
    ""
  ).trim();

  if (!idToken && options.promptForToken) {
    idToken = await promptToken();
  }

  const capabilityResolution = await findWorkingPath(baseUrl, capabilitiesPath, ["/capabilities"]);
  const connectorResolution = await findWorkingPath(baseUrl, connectorPath, []);

  const capabilityUrl = `${baseUrl}${capabilityResolution.path}`;
  const connectorUrl = `${baseUrl}${connectorResolution.path}`;
  const adminConfigured = adminToken.length > 0;

  const capabilityCases = [
    summarizeCase(await probe("A anonymous", capabilityUrl, {}), "reject"),
    summarizeCase(
      idToken
        ? await probe("B bearer only", capabilityUrl, { Authorization: `Bearer ${idToken}` })
        : {
            label: "B bearer only",
            url: capabilityUrl,
            statusCode: -1,
            body: "",
            error: "Skipped: no ID token. Set STUDIO_BRAIN_ID_TOKEN or pass --prompt-for-token.",
          },
      adminConfigured ? "deny" : "allow",
    ),
    summarizeCase(
      idToken && adminConfigured
        ? await probe("C bearer + x-studio-brain-admin-token", capabilityUrl, {
            Authorization: `Bearer ${idToken}`,
            "x-studio-brain-admin-token": adminToken,
          })
        : {
            label: "C bearer + x-studio-brain-admin-token",
            url: capabilityUrl,
            statusCode: -1,
            body: "",
            error: adminConfigured
              ? "Skipped: missing STUDIO_BRAIN_ID_TOKEN."
              : "Skipped: STUDIO_BRAIN_ADMIN_TOKEN is not configured.",
          },
      "allow",
    ),
  ];

  const connectorCases = [
    summarizeCase(await probe("A anonymous", connectorUrl, {}), "reject"),
    summarizeCase(
      idToken
        ? await probe("B bearer only", connectorUrl, { Authorization: `Bearer ${idToken}` })
        : {
            label: "B bearer only",
            url: connectorUrl,
            statusCode: -1,
            body: "",
            error: "Skipped: no ID token. Set STUDIO_BRAIN_ID_TOKEN or pass --prompt-for-token.",
          },
      adminConfigured ? "deny" : "allow",
    ),
    summarizeCase(
      idToken && adminConfigured
        ? await probe("C bearer + x-studio-brain-admin-token", connectorUrl, {
            Authorization: `Bearer ${idToken}`,
            "x-studio-brain-admin-token": adminToken,
          })
        : {
            label: "C bearer + x-studio-brain-admin-token",
            url: connectorUrl,
            statusCode: -1,
            body: "",
            error: adminConfigured
              ? "Skipped: missing STUDIO_BRAIN_ID_TOKEN."
              : "Skipped: STUDIO_BRAIN_ADMIN_TOKEN is not configured.",
          },
      "allow",
    ),
  ];

  const allCases = [...capabilityCases, ...connectorCases];
  const hasFailures = allCases.some((entry) => entry.status === "fail");
  const requiresPrivilegedMatrix =
    options.mode === POSTURE_MODES.AUTHENTICATED_PRIVILEGED_CHECK ||
    options.mode === POSTURE_MODES.LIVE_HOST_AUTHORITATIVE;
  const missingRequiredCredentials = requiresPrivilegedMatrix && (!idToken || (adminConfigured && !adminToken));
  const skippedRequiredCases =
    requiresPrivilegedMatrix &&
    allCases.some((entry) => entry.status === "skip" && entry.expectation !== "deny");

  const status = hasFailures || skippedRequiredCases || missingRequiredCredentials
    ? "fail"
    : allCases.some((entry) => entry.status === "skip")
      ? "warn"
      : "pass";

  const report = {
    schemaVersion: "studio-brain-auth-probe.v2",
    generatedAt: new Date().toISOString(),
    baseUrl,
    capabilityPath: capabilityResolution.path,
    connectorPath: connectorResolution.path,
    status,
    adminConfigured,
    tokens: {
      idToken: idToken ? redactToken(idToken) : "missing",
      adminToken: adminToken ? redactToken(adminToken) : "missing",
    },
    surfaces: [
      {
        name: "capabilities",
        path: capabilityResolution.path,
        cases: capabilityCases,
      },
      {
        name: "connectors-health",
        path: connectorResolution.path,
        cases: connectorCases,
      },
    ],
    provenance: buildArtifactProvenance({
      mode: options.mode,
      envSource: explicitOptionBaseUrl ? "explicit-base-url" : "resolved-from-env",
      envMode: explicitOptionBaseUrl ? "explicit" : "repo-bootstrap",
      approvedRemoteRunner: options.approvedRemoteRunner,
      host: new URL(baseUrl).host,
      generator: "scripts/test-studio-brain-auth.mjs",
      dataClassification: DATA_CLASSIFICATIONS.OPERATIONAL_METADATA,
      redactionState: REDACTION_STATES.VERIFIED_REDACTED,
      sourceSystems: ["studio-brain-http"],
    }),
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    printHumanSummary(report);
  }

  if (status !== "pass") {
    process.exit(1);
  }
};

run().catch((error) => {
  console.error("Studio Brain auth probe failed:", error);
  process.exit(1);
});
