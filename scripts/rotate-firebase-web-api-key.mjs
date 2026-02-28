#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseCsv(value, fallback = []) {
  if (!value || !String(value).trim()) return [...fallback];
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"],
    input: options.stdin,
    env: options.env ?? process.env,
  });

  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    const stdout = (result.stdout || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}). ${stderr || stdout || "No output"}`
    );
  }

  return (result.stdout || "").trim();
}

function timestampSlug(date = new Date()) {
  const iso = date.toISOString();
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveCreateResult(createOutput, projectId, displayName) {
  const created = JSON.parse(createOutput);
  const operationName = String(created?.name || "");
  if (!operationName) {
    throw new Error("gcloud did not return a name while creating API key.");
  }

  if (!operationName.startsWith("operations/")) {
    return created;
  }

  for (let attempt = 0; attempt < 120; attempt += 1) {
    const listOutput = run("gcloud", [
      "services",
      "api-keys",
      "list",
      `--project=${projectId}`,
      "--format=json",
      `--filter=displayName=${displayName}`,
    ]);
    const keys = JSON.parse(listOutput);

    if (Array.isArray(keys) && keys.length > 0) {
      const latest = [...keys]
        .filter((key) => key?.name)
        .sort((a, b) => {
          const ad = new Date(a.createTime || 0).getTime();
          const bd = new Date(b.createTime || 0).getTime();
          return bd - ad;
        })[0];
      if (latest?.name) return latest;
    }

    await sleep(5000);
  }

  throw new Error(
    `Timed out waiting for key resource to appear for operation ${operationName} (displayName=${displayName}).`
  );
}

async function main() {
  const dryRun = parseBool(process.env.DRY_RUN, false);
  const resolveAlert = parseBool(process.env.RESOLVE_ALERT, false);
  const disablePrevious = parseBool(process.env.ROTATE_DISABLE_PREVIOUS, true);

  const repo = requireEnv("GITHUB_REPOSITORY");
  const projectId = process.env.GCP_PROJECT_ID?.trim() || "monsoonfire-portal";
  const rotationReason = process.env.ROTATION_REASON?.trim() || "unspecified";
  const alertNumber = process.env.ALERT_NUMBER?.trim() || "";
  const displayPrefix = process.env.WEB_KEY_DISPLAY_NAME_PREFIX?.trim() || "monsoonfire-portal-web";
  const primarySecretName = process.env.WEB_KEY_SECRET_NAME?.trim() || "FIREBASE_WEB_API_KEY";
  const secretNames = Array.from(
    new Set(parseCsv(process.env.WEB_KEY_SECRET_NAMES, [primarySecretName, "PORTAL_FIREBASE_API_KEY"]))
  ).filter(Boolean);
  const resourceSecretName = process.env.WEB_KEY_RESOURCE_SECRET_NAME?.trim() || "FIREBASE_WEB_API_KEY_RESOURCE";

  const allowedReferrers = parseCsv(process.env.WEB_KEY_ALLOWED_REFERRERS, [
    "https://monsoonfire-portal.web.app/*",
    "https://monsoonfire-portal.firebaseapp.com/*",
    "https://monsoonfire.com/*",
    "https://*.monsoonfire.com/*",
    "http://localhost:5173/*",
    "http://127.0.0.1:5173/*",
  ]);

  const apiTargets = parseCsv(process.env.WEB_KEY_API_TARGETS, [
    "identitytoolkit.googleapis.com",
    "securetoken.googleapis.com",
    "firebaseinstallations.googleapis.com",
    "firestore.googleapis.com",
  ]);

  if (!dryRun) {
    requireEnv("GH_TOKEN");
  }
  if (secretNames.length === 0) {
    throw new Error("No target web key secret names resolved. Set WEB_KEY_SECRET_NAMES.");
  }

  const previousResource = (process.env.PREVIOUS_KEY_RESOURCE || "").trim();
  const displayName = `${displayPrefix}-${timestampSlug()}`;

  let newKeyResource = `projects/${projectId}/locations/global/keys/dry-run-${timestampSlug()}`;
  let newKeyValue = `dry-run-${timestampSlug()}`;
  let previousDisabled = false;
  let previousKeyAction = "left enabled (no previous resource configured)";
  let alertResolved = false;

  if (!dryRun) {
    const createArgs = [
      "services",
      "api-keys",
      "create",
      `--project=${projectId}`,
      `--display-name=${displayName}`,
      "--format=json",
    ];

    for (const referrer of allowedReferrers) createArgs.push(`--allowed-referrers=${referrer}`);
    for (const service of apiTargets) createArgs.push(`--api-target=service=${service}`);

    const createOutput = run("gcloud", createArgs);
    const created = await resolveCreateResult(createOutput, projectId, displayName);
    if (!created?.name) {
      throw new Error("gcloud did not return key resource name while creating API key.");
    }

    newKeyResource = String(created.name);
    newKeyValue = created?.keyString ? String(created.keyString) : "";

    if (!newKeyValue) {
      const keyStringOutput = run("gcloud", [
        "services",
        "api-keys",
        "get-key-string",
        newKeyResource,
        `--project=${projectId}`,
        "--format=json",
      ]);
      const keyStringPayload = JSON.parse(keyStringOutput);
      if (!keyStringPayload?.keyString) {
        throw new Error("gcloud did not return keyString after key creation.");
      }
      newKeyValue = String(keyStringPayload.keyString);
    }

    console.log(`::add-mask::${newKeyValue}`);

    for (const secretName of secretNames) {
      run(
        "gh",
        ["secret", "set", secretName, "-R", repo],
        { stdin: newKeyValue, env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN } }
      );
    }

    run(
      "gh",
      ["secret", "set", resourceSecretName, "-R", repo],
      { stdin: `${newKeyResource}\n`, env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN } }
    );

    if (disablePrevious && previousResource && previousResource !== newKeyResource) {
      try {
        run("gcloud", [
          "services",
          "api-keys",
          "delete",
          previousResource,
          `--project=${projectId}`,
          "--quiet",
        ]);
        previousDisabled = true;
        previousKeyAction = "revoked";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/not found|NOT_FOUND/i.test(message)) {
          previousDisabled = true;
          previousKeyAction = "already absent";
        } else {
          throw error;
        }
      }
    } else if (!disablePrevious && previousResource) {
      previousKeyAction = "left enabled (rotation policy disabled)";
    } else if (previousResource && previousResource === newKeyResource) {
      previousKeyAction = "left enabled (same resource reused)";
    }

    if (resolveAlert && alertNumber) {
      const comment =
        `Automated rotation completed (${displayName}). New key issued with browser/API restrictions, ` +
        `GitHub secrets ${secretNames.join(", ")} updated, and previous key ${previousKeyAction}.`;
      run(
        "gh",
        [
          "api",
          "--method",
          "PATCH",
          `repos/${repo}/secret-scanning/alerts/${alertNumber}`,
          "-f",
          "state=resolved",
          "-f",
          "resolution=revoked",
          "-f",
          `resolution_comment=${comment}`,
        ],
        { env: { ...process.env, GH_TOKEN: process.env.GH_TOKEN } }
      );
      alertResolved = true;
    }
  }

  const report = {
    generatedAtUtc: new Date().toISOString(),
    dryRun,
    repository: repo,
    projectId,
    rotationReason,
    alertNumber: alertNumber || null,
    resolveAlert,
    alertResolved,
    secretName: primarySecretName,
    secretNames,
    resourceSecretName,
    displayName,
    newKeyResource,
    previousKeyResource: previousResource || null,
    previousDisabled,
    previousKeyAction,
    allowedReferrers,
    apiTargets,
    disablePrevious,
  };

  const outputDir = path.resolve("output/security");
  await mkdir(outputDir, { recursive: true });

  const timestamp = timestampSlug();
  const runPath = path.join(outputDir, `key-rotation-${timestamp}.json`);
  const latestPath = path.join(outputDir, "key-rotation-latest.json");

  await writeFile(runPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(latestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Rotation report written: ${runPath}`);
  console.log(`Rotation report written: ${latestPath}`);
  console.log(`Key rotation ${dryRun ? "dry-run " : ""}complete. New key resource: ${newKeyResource}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
