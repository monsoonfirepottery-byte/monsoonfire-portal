#!/usr/bin/env node

/* eslint-disable no-console */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const LEGACY_RELEASE_ID = "cloud.firestore";
const DEFAULT_DB_RELEASE_ID = "cloud.firestore/default";

function parseArgs(argv) {
  const options = {
    projectId: process.env.FIREBASE_PROJECT || DEFAULT_PROJECT_ID,
    accessToken:
      process.env.FIREBASE_RULES_API_TOKEN ||
      process.env.FIREBASE_ACCESS_TOKEN ||
      "",
    checkOnly: false,
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--project") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --project");
      }
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--check") {
      options.checkOnly = true;
      continue;
    }

    if (arg === "--access-token") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --access-token");
      }
      options.accessToken = String(next).trim();
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  return options;
}

async function loadFirebaseCliToken() {
  const configPath = resolve(homedir(), ".config", "configstore", "firebase-tools.json");
  const raw = await readFile(configPath, "utf8");
  const parsed = JSON.parse(raw);
  const accessToken = parsed?.tokens?.access_token;
  const expiresAtMs =
    typeof parsed?.tokens?.expires_at === "number" ? parsed.tokens.expires_at : Number.NaN;

  if (!accessToken || typeof accessToken !== "string") {
    throw new Error("Missing firebase-tools access token. Run `firebase login` and retry.");
  }

  return {
    configPath,
    accessToken,
    expiresAtMs,
    source: "firebase-tools-config",
  };
}

async function resolveAccessToken(options) {
  const directToken = String(options.accessToken || "").trim();
  if (directToken) {
    return {
      configPath: null,
      accessToken: directToken,
      expiresAtMs: Number.NaN,
      source: "env-or-arg",
    };
  }

  return await loadFirebaseCliToken();
}

async function requestRulesApi({ accessToken, path, method = "GET", body = null }) {
  const resp = await fetch(`https://firebaserules.googleapis.com/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await resp.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 600) };
  }

  return { ok: resp.ok, status: resp.status, json };
}

function releasePath(projectId, releaseId) {
  return `projects/${projectId}/releases/${releaseId}`;
}

async function getRelease(projectId, releaseId, accessToken) {
  return await requestRulesApi({
    accessToken,
    path: releasePath(projectId, releaseId),
  });
}

async function patchRelease(projectId, releaseId, rulesetName, accessToken) {
  return await requestRulesApi({
    accessToken,
    path: `${releasePath(projectId, releaseId)}?updateMask=ruleset_name`,
    method: "PATCH",
    body: {
      release: {
        name: releasePath(projectId, releaseId),
        ruleset_name: rulesetName,
      },
    },
  });
}

function printResult(result, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`project: ${result.projectId}\n`);
  process.stdout.write(`legacy release: ${result.legacyRelease.name}\n`);
  process.stdout.write(`legacy ruleset: ${result.legacyRelease.rulesetName}\n`);
  process.stdout.write(`default release: ${result.defaultRelease.name}\n`);
  process.stdout.write(`default ruleset: ${result.defaultRelease.rulesetName}\n`);
  process.stdout.write(`status: ${result.status}\n`);
  if (result.message) {
    process.stdout.write(`${result.message}\n`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const tokenInfo = await resolveAccessToken(options);
  const nowMs = Date.now();
  const isLikelyExpired =
    Number.isFinite(tokenInfo.expiresAtMs) && tokenInfo.expiresAtMs < nowMs - 15_000;

  const [legacyResp, defaultResp] = await Promise.all([
    getRelease(options.projectId, LEGACY_RELEASE_ID, tokenInfo.accessToken),
    getRelease(options.projectId, DEFAULT_DB_RELEASE_ID, tokenInfo.accessToken),
  ]);

  if (!legacyResp.ok || !defaultResp.ok) {
    const result = {
      projectId: options.projectId,
      status: "error",
      message: isLikelyExpired
        ? "Firebase CLI access token appears expired. Run `firebase login` then retry."
        : "Could not read one or more Firestore release bindings.",
      tokenSource: tokenInfo.source,
      legacyRelease: legacyResp,
      defaultRelease: defaultResp,
    };
    printResult(result, options.asJson);
    process.exit(1);
  }

  const legacyRulesetName = String(legacyResp.json?.rulesetName || "");
  const defaultRulesetName = String(defaultResp.json?.rulesetName || "");
  const releasesMatch = legacyRulesetName && legacyRulesetName === defaultRulesetName;

  const baseResult = {
    projectId: options.projectId,
    status: releasesMatch ? "in_sync" : options.checkOnly ? "drift_detected" : "updating",
    legacyRelease: {
      name: String(legacyResp.json?.name || releasePath(options.projectId, LEGACY_RELEASE_ID)),
      rulesetName: legacyRulesetName,
      updateTime: legacyResp.json?.updateTime ?? null,
    },
    defaultRelease: {
      name: String(defaultResp.json?.name || releasePath(options.projectId, DEFAULT_DB_RELEASE_ID)),
      rulesetName: defaultRulesetName,
      updateTime: defaultResp.json?.updateTime ?? null,
    },
    tokenSource: tokenInfo.source,
  };

  if (releasesMatch) {
    printResult(
      {
        ...baseResult,
        message: "Firestore releases are already aligned.",
      },
      options.asJson
    );
    return;
  }

  if (options.checkOnly) {
    printResult(
      {
        ...baseResult,
        message:
          "Firestore release drift detected. Run `npm run firestore:rules:sync` to align cloud.firestore with cloud.firestore/default.",
      },
      options.asJson
    );
    process.exit(2);
  }

  const patchResp = await patchRelease(
    options.projectId,
    LEGACY_RELEASE_ID,
    defaultRulesetName,
    tokenInfo.accessToken
  );
  if (!patchResp.ok) {
    printResult(
      {
        ...baseResult,
        status: "error",
        message: "Failed to patch legacy Firestore release binding.",
        patch: patchResp,
      },
      options.asJson
    );
    process.exit(1);
  }

  printResult(
    {
      ...baseResult,
      status: "updated",
      message: "Updated cloud.firestore to the current cloud.firestore/default ruleset.",
      patch: {
        name: patchResp.json?.name ?? null,
        rulesetName: patchResp.json?.rulesetName ?? null,
        updateTime: patchResp.json?.updateTime ?? null,
      },
    },
    options.asJson
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`sync-firestore-rules-releases failed: ${message}`);
  process.exit(1);
});
