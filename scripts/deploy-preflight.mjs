#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_NAMECHEAP_SERVER = "monsggbd@66.29.137.142";
const DEFAULT_NAMECHEAP_PORT = 21098;
const DEFAULT_NAMECHEAP_KEY = resolve(homedir(), ".ssh", "namecheap-portal");
const DEFAULT_NAMECHEAP_REMOTE_PATH = "portal/";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "deploy-preflight.json");
const FIREBASE_WEB_APP_ID = "1:667865114946:web:7275b02c9345aa975200db";
const FIREBASE_PROJECT_ID = "monsoonfire-portal";
const FIREBASE_API_KEY_REGEX = /^AIza[0-9A-Za-z_-]{20,}$/;

function parseArgs(argv) {
  const options = {
    target: "namecheap-portal",
    asJson: false,
    strict: true,
    requirePromotionGate: true,
    reportPath: DEFAULT_REPORT_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }

    if (arg === "--no-strict") {
      options.strict = false;
      continue;
    }

    if (arg === "--strict") {
      options.strict = true;
      continue;
    }

    if (arg === "--skip-promotion-gate") {
      options.requirePromotionGate = false;
      continue;
    }

    if (arg === "--require-promotion-gate") {
      options.requirePromotionGate = true;
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    if (arg === "--target") {
      options.target = String(next).trim().toLowerCase();
      index += 1;
      continue;
    }

    if (arg === "--report") {
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
  }

  const supported = new Set(["namecheap-portal", "namecheap-website", "firebase", "all"]);
  if (!supported.has(options.target)) {
    throw new Error(`Unsupported --target value: ${options.target}`);
  }

  return options;
}

function expandHomePath(input) {
  if (!input || input === "~") return homedir();
  if (input.startsWith("~/")) return resolve(homedir(), input.slice(2));
  return input;
}

function asStatus(ok) {
  return ok ? "passed" : "failed";
}

function addCheck(summary, label, ok, { required = true, detail = "", hint = "" } = {}) {
  summary.checks.push({
    label,
    status: asStatus(ok),
    required,
    detail,
    hint,
  });
}

function readJsonFileSafe(path) {
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function parseAgentCredentialPayload(raw) {
  if (!raw) return { ok: false, reason: "Empty payload." };
  try {
    const parsed = JSON.parse(raw);
    const refreshToken = String(parsed?.refreshToken || "").trim();
    const uid = String(parsed?.uid || "").trim();
    const email = String(parsed?.email || "").trim();
    if (!refreshToken || !uid || !email) {
      return {
        ok: false,
        reason: "Payload must include refreshToken, uid, and email.",
      };
    }
    return { ok: true, reason: "Credential payload is parseable and complete." };
  } catch (error) {
    return {
      ok: false,
      reason: `Invalid JSON payload (${error instanceof Error ? error.message : String(error)}).`,
    };
  }
}

function hasFirebaseCliSession() {
  const probe = spawnSync("npx", ["firebase-tools", "projects:list", "--non-interactive", "--json"], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
  });
  return probe.status === 0;
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

function canResolveFirebaseWebApiKey() {
  const candidateValues = [
    String(process.env.VITE_FIREBASE_API_KEY || "").trim(),
    String(process.env.PORTAL_FIREBASE_API_KEY || "").trim(),
    String(process.env.FIREBASE_WEB_API_KEY || "").trim(),
  ];
  if (candidateValues.some((value) => looksLikeFirebaseApiKey(value))) {
    return { ok: true, source: "env" };
  }

  const probe = spawnSync(
    "npx",
    ["firebase-tools", "apps:sdkconfig", "web", FIREBASE_WEB_APP_ID, "--project", FIREBASE_PROJECT_ID],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (probe.status !== 0) {
    return { ok: false, source: "firebase-tools", detail: (probe.stderr || probe.stdout || "").trim() };
  }

  const payload = parseJsonObjectFromMixedOutput(probe.stdout);
  const apiKey = String(payload?.apiKey || "").trim();
  if (looksLikeFirebaseApiKey(apiKey)) {
    return { ok: true, source: "firebase-tools-apps:sdkconfig" };
  }

  return { ok: false, source: "firebase-tools", detail: "No valid apiKey found in apps:sdkconfig output." };
}

function runNamecheapPortalChecks(summary, options) {
  const server = String(process.env.WEBSITE_DEPLOY_SERVER || DEFAULT_NAMECHEAP_SERVER).trim();
  const port = Number.parseInt(process.env.WEBSITE_DEPLOY_PORT || "", 10) || DEFAULT_NAMECHEAP_PORT;
  const keyPath = expandHomePath(process.env.WEBSITE_DEPLOY_KEY || DEFAULT_NAMECHEAP_KEY);
  const remotePath = String(process.env.WEBSITE_DEPLOY_REMOTE_PATH || DEFAULT_NAMECHEAP_REMOTE_PATH).trim();

  addCheck(summary, "deploy target server is configured", server.length > 0, {
    detail: server ? `Resolved server: ${server}` : "No deploy server resolved.",
    hint: "Set WEBSITE_DEPLOY_SERVER or pass --server at deploy time.",
  });

  addCheck(summary, "deploy SSH port is valid", Number.isInteger(port) && port > 0 && port <= 65535, {
    detail: `Resolved port: ${String(port)}`,
    hint: "Set WEBSITE_DEPLOY_PORT to an integer between 1 and 65535.",
  });

  addCheck(summary, "deploy SSH key exists", existsSync(keyPath), {
    detail: `Resolved key path: ${keyPath}`,
    hint: "Set WEBSITE_DEPLOY_KEY to a valid private key path.",
  });

  addCheck(summary, "remote deploy path is configured", remotePath.length > 0, {
    detail: `Resolved remote path: ${remotePath || "<empty>"}`,
    hint: "Set WEBSITE_DEPLOY_REMOTE_PATH when changing remote location.",
  });

  const firebaseWebKey = canResolveFirebaseWebApiKey();
  addCheck(summary, "firebase web api key is configured or resolvable", firebaseWebKey.ok, {
    detail: firebaseWebKey.ok
      ? `Firebase web API key source: ${firebaseWebKey.source}.`
      : `Unable to resolve Firebase web API key (${firebaseWebKey.source}).`,
    hint:
      "Set VITE_FIREBASE_API_KEY, PORTAL_FIREBASE_API_KEY, or FIREBASE_WEB_API_KEY, or ensure firebase-tools access to apps:sdkconfig.",
  });

  const htaccessPath = resolve(repoRoot, "web", "deploy", "namecheap", ".htaccess");
  addCheck(summary, "namecheap .htaccess template exists", existsSync(htaccessPath), {
    detail: htaccessPath,
    hint: "Restore web/deploy/namecheap/.htaccess before deploy.",
  });

  const wellKnownFiles = [
    resolve(repoRoot, "website", ".well-known", "apple-app-site-association"),
    resolve(repoRoot, "website", ".well-known", "assetlinks.json"),
  ];
  for (const path of wellKnownFiles) {
    addCheck(summary, `.well-known asset exists (${path.split("/").slice(-1)[0]})`, existsSync(path), {
      detail: path,
      hint: "Restore required .well-known file before deploy.",
    });
  }

  if (options.requirePromotionGate) {
    const staffEmail = String(process.env.PORTAL_STAFF_EMAIL || "").trim();
    const staffPassword = String(process.env.PORTAL_STAFF_PASSWORD || "").trim();

    addCheck(summary, "promotion gate staff email is present", staffEmail.length > 0, {
      detail: staffEmail ? "Staff email detected." : "PORTAL_STAFF_EMAIL is missing.",
      hint: "Set PORTAL_STAFF_EMAIL for authenticated canary.",
    });

    addCheck(summary, "promotion gate staff password is present", staffPassword.length > 0, {
      detail: staffPassword ? "Staff password detected." : "PORTAL_STAFF_PASSWORD is missing.",
      hint: "Set PORTAL_STAFF_PASSWORD for authenticated canary.",
    });

    const rulesToken = String(process.env.FIREBASE_RULES_API_TOKEN || "").trim();
    addCheck(summary, "promotion gate Firestore Rules API token is present", rulesToken.length > 0, {
      detail: rulesToken ? "FIREBASE_RULES_API_TOKEN detected." : "FIREBASE_RULES_API_TOKEN is missing.",
      hint: "Set FIREBASE_RULES_API_TOKEN for backend regression/rules checks.",
    });

    const firebaseToken = String(process.env.FIREBASE_TOKEN || "").trim();
    const serviceAccountJson = String(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL || ""
    ).trim();
    const gacPath = expandHomePath(String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim());

    let serviceAccountJsonValid = false;
    if (serviceAccountJson) {
      try {
        const parsed = JSON.parse(serviceAccountJson);
        serviceAccountJsonValid =
          typeof parsed?.client_email === "string" &&
          parsed.client_email.trim().length > 0 &&
          typeof parsed?.private_key === "string" &&
          parsed.private_key.trim().length > 0;
      } catch {
        serviceAccountJsonValid = false;
      }
    }

    const hasIndexDeployAuth =
      firebaseToken.length > 0 ||
      (gacPath.length > 0 && existsSync(gacPath)) ||
      serviceAccountJsonValid ||
      hasFirebaseCliSession();
    addCheck(summary, "promotion gate Firestore index deploy auth is configured", hasIndexDeployAuth, {
      detail: hasIndexDeployAuth
        ? "Index deploy auth detected via FIREBASE_TOKEN, GOOGLE_APPLICATION_CREDENTIALS, service-account JSON, or local Firebase CLI session."
        : "No index deploy auth detected.",
      hint: "Set FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL (recommended), FIREBASE_TOKEN, or ensure local Firebase CLI login before deploy.",
    });

    const credsJson = String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS_JSON || "").trim();
    const credsPathEnv = String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS || "").trim();
    const credsPath = credsPathEnv ? resolve(process.cwd(), credsPathEnv) : "";

    if (credsJson) {
      const parsed = parseAgentCredentialPayload(credsJson);
      addCheck(summary, "agent staff credentials JSON payload is valid", parsed.ok, {
        detail: parsed.reason,
        hint: "Ensure PORTAL_AGENT_STAFF_CREDENTIALS_JSON includes refreshToken, uid, and email.",
      });
    } else if (credsPath) {
      const exists = existsSync(credsPath);
      addCheck(summary, "agent staff credentials path exists", exists, {
        detail: exists ? credsPath : `Missing file: ${credsPath}`,
        hint: "Set PORTAL_AGENT_STAFF_CREDENTIALS to a readable JSON credentials file.",
      });
      if (exists) {
        const parsed = readJsonFileSafe(credsPath);
        const validation = parseAgentCredentialPayload(parsed ? JSON.stringify(parsed) : "");
        addCheck(summary, "agent staff credential file content is valid", validation.ok, {
          detail: validation.reason,
          hint: "Credential file must contain refreshToken, uid, and email.",
        });
      }
    } else {
      addCheck(summary, "agent staff credentials are configured", false, {
        detail: "Neither PORTAL_AGENT_STAFF_CREDENTIALS_JSON nor PORTAL_AGENT_STAFF_CREDENTIALS is set.",
        hint: "Provide staff credential JSON via env var or file path.",
      });
    }
  }
}

function runNamecheapWebsiteChecks(summary) {
  const server = String(process.env.WEBSITE_DEPLOY_SERVER || DEFAULT_NAMECHEAP_SERVER).trim();
  const keyPath = expandHomePath(process.env.WEBSITE_DEPLOY_KEY || DEFAULT_NAMECHEAP_KEY);
  const source = resolve(repoRoot, "website", "ncsitebuilder");

  addCheck(summary, "website deploy target server is configured", server.length > 0, {
    detail: server ? `Resolved server: ${server}` : "No deploy server resolved.",
    hint: "Set WEBSITE_DEPLOY_SERVER before website deploy.",
  });

  addCheck(summary, "website deploy SSH key exists", existsSync(keyPath), {
    detail: `Resolved key path: ${keyPath}`,
    hint: "Set WEBSITE_DEPLOY_KEY to a valid private key path.",
  });

  addCheck(summary, "website deploy source directory exists", existsSync(source), {
    detail: source,
    hint: "Ensure website/ncsitebuilder exists before website deploy.",
  });
}

function runFirebaseChecks(summary) {
  const firebaseToken = String(process.env.FIREBASE_TOKEN || "").trim();
  addCheck(summary, "firebase token is present (recommended for CI/non-interactive deploy)", firebaseToken.length > 0, {
    required: false,
    detail: firebaseToken ? "FIREBASE_TOKEN detected." : "FIREBASE_TOKEN not set.",
    hint: "Set FIREBASE_TOKEN for non-interactive deploy automation.",
  });

  const firebaseProject = String(process.env.FIREBASE_PROJECT || "monsoonfire-portal").trim();
  addCheck(summary, "firebase project id is resolved", firebaseProject.length > 0, {
    detail: `Resolved project: ${firebaseProject}`,
    hint: "Set FIREBASE_PROJECT when running against non-default projects.",
  });
}

function finalize(summary, strict) {
  const requiredFailures = summary.checks.filter((check) => check.required && check.status === "failed");
  const optionalFailures = summary.checks.filter((check) => !check.required && check.status === "failed");

  summary.totals = {
    checks: summary.checks.length,
    requiredFailures: requiredFailures.length,
    optionalFailures: optionalFailures.length,
  };

  summary.status = requiredFailures.length > 0 ? "failed" : "passed";
  summary.strict = strict;

  if (!strict && summary.status === "failed") {
    summary.status = "warning";
  }

  return summary;
}

function printHuman(summary) {
  process.stdout.write(`status: ${summary.status}\n`);
  process.stdout.write(`target: ${summary.target}\n`);
  process.stdout.write(`promotionGateRequired: ${String(summary.requirePromotionGate)}\n`);
  for (const check of summary.checks) {
    process.stdout.write(`- ${check.label}: ${check.status}`);
    if (check.detail) process.stdout.write(` (${check.detail})`);
    process.stdout.write("\n");
    if (check.status === "failed" && check.hint) {
      process.stdout.write(`  hint: ${check.hint}\n`);
    }
  }
  process.stdout.write(`report: ${summary.reportPath}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  const summary = {
    status: "passed",
    target: options.target,
    requirePromotionGate: options.requirePromotionGate,
    runAtIso: new Date().toISOString(),
    reportPath: options.reportPath,
    checks: [],
    totals: {
      checks: 0,
      requiredFailures: 0,
      optionalFailures: 0,
    },
  };

  if (options.target === "namecheap-portal" || options.target === "all") {
    runNamecheapPortalChecks(summary, options);
  }
  if (options.target === "namecheap-website" || options.target === "all") {
    runNamecheapWebsiteChecks(summary);
  }
  if (options.target === "firebase" || options.target === "all") {
    runFirebaseChecks(summary);
  }

  finalize(summary, options.strict);

  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    printHuman(summary);
  }

  if (summary.status === "failed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`deploy-preflight failed: ${message}`);
  process.exit(1);
});
