#!/usr/bin/env node

/* eslint-disable no-console */

import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(__filename), "..");

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_REPORT_PATH = resolve(repoRoot, "output", "qa", "firestore-indexes-deploy.json");

function parseArgs(argv) {
  const options = {
    projectId: String(process.env.FIREBASE_PROJECT || DEFAULT_PROJECT_ID).trim(),
    reportPath: process.env.FIRESTORE_INDEX_DEPLOY_REPORT
      ? resolve(process.cwd(), String(process.env.FIRESTORE_INDEX_DEPLOY_REPORT).trim())
      : DEFAULT_REPORT_PATH,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--project") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --project");
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--report") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --report");
      options.reportPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  if (!options.projectId) {
    throw new Error("Project id is required.");
  }

  return options;
}

function truncate(value, max = 16000) {
  if (typeof value !== "string") return "";
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[truncated ${value.length - max} chars]`;
}

function parseServiceAccount(raw) {
  if (!raw) return { ok: false, message: "empty" };
  try {
    const parsed = JSON.parse(raw);
    const clientEmail = String(parsed?.client_email || "").trim();
    const privateKey = String(parsed?.private_key || "").trim();
    if (!clientEmail || !privateKey) {
      return { ok: false, message: "missing client_email/private_key" };
    }
    return { ok: true, payload: parsed };
  } catch (error) {
    return {
      ok: false,
      message: `invalid json (${error instanceof Error ? error.message : String(error)})`,
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

async function resolveAuthEnv() {
  const firebaseToken = String(process.env.FIREBASE_TOKEN || "").trim();
  if (firebaseToken) {
    return {
      ok: true,
      authSource: "FIREBASE_TOKEN",
      cleanupDir: "",
      extraEnv: {},
      notes: [],
    };
  }

  const gacPath = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (gacPath && existsSync(gacPath)) {
    return {
      ok: true,
      authSource: "GOOGLE_APPLICATION_CREDENTIALS",
      cleanupDir: "",
      extraEnv: {},
      notes: [],
    };
  }

  if (hasFirebaseCliSession()) {
    return {
      ok: true,
      authSource: "firebase-cli-session",
      cleanupDir: "",
      extraEnv: {},
      notes: [],
    };
  }

  const rawServiceAccount = String(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
      process.env.FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL ||
      ""
  ).trim();
  if (!rawServiceAccount) {
    return {
      ok: false,
      authSource: "none",
      cleanupDir: "",
      extraEnv: {},
      notes: [
        "Missing deploy auth. Set FIREBASE_TOKEN, GOOGLE_APPLICATION_CREDENTIALS, or FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL.",
      ],
    };
  }

  const parsed = parseServiceAccount(rawServiceAccount);
  if (!parsed.ok) {
    return {
      ok: false,
      authSource: "service-account-env-invalid",
      cleanupDir: "",
      extraEnv: {},
      notes: [`Service account payload invalid: ${parsed.message}`],
    };
  }

  const tempDir = await mkdtemp(resolve(tmpdir(), "firebase-sa-"));
  const credentialsPath = resolve(tempDir, "service-account.json");
  await writeFile(credentialsPath, `${JSON.stringify(parsed.payload, null, 2)}\n`, "utf8");

  return {
    ok: true,
    authSource: "FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL",
    cleanupDir: tempDir,
    extraEnv: {
      GOOGLE_APPLICATION_CREDENTIALS: credentialsPath,
    },
    notes: [],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAtIso = new Date().toISOString();

  const auth = await resolveAuthEnv();
  const summary = {
    status: "running",
    projectId: options.projectId,
    startedAtIso,
    finishedAtIso: "",
    reportPath: options.reportPath,
    authSource: auth.authSource,
    command: "",
    exitCode: 0,
    stdout: "",
    stderr: "",
    notes: auth.notes || [],
  };

  if (!auth.ok) {
    summary.status = "failed";
    summary.exitCode = 1;
    summary.finishedAtIso = new Date().toISOString();
    await mkdir(dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    if (options.asJson) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      process.stdout.write(`status: failed\n`);
      summary.notes.forEach((note) => process.stdout.write(`note: ${note}\n`));
      process.stdout.write(`report: ${summary.reportPath}\n`);
    }
    process.exit(1);
  }

  try {
    const args = [
      "firebase-tools",
      "deploy",
      "--only",
      "firestore:indexes",
      "--project",
      options.projectId,
      "--non-interactive",
    ];
    summary.command = `npx ${args.join(" ")}`;

    const result = spawnSync("npx", args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ...auth.extraEnv,
      },
      encoding: "utf8",
    });

    summary.exitCode = typeof result.status === "number" ? result.status : 1;
    summary.stdout = truncate(result.stdout || "");
    summary.stderr = truncate(result.stderr || "");
    summary.status = summary.exitCode === 0 ? "passed" : "failed";
  } finally {
    if (auth.cleanupDir) {
      await rm(auth.cleanupDir, { recursive: true, force: true });
    }
  }

  summary.finishedAtIso = new Date().toISOString();
  await mkdir(dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`projectId: ${summary.projectId}\n`);
    process.stdout.write(`authSource: ${summary.authSource}\n`);
    process.stdout.write(`exitCode: ${summary.exitCode}\n`);
    process.stdout.write(`report: ${summary.reportPath}\n`);
  }

  if (summary.status !== "passed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`firestore-indexes-deploy failed: ${message}`);
  process.exit(1);
});
