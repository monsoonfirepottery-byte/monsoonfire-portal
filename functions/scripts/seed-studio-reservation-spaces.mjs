#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { mintStaffIdTokenFromPortalEnv } from "../../scripts/lib/firebase-auth-token.mjs";

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_FUNCTIONS_BASE_URL = `https://us-central1-${DEFAULT_PROJECT_ID}.cloudfunctions.net`;
const DEFAULT_PORTAL_AUTOMATION_ENV_PATH = resolve(
  process.cwd(),
  "secrets",
  "portal",
  "portal-automation.env"
);
const LIST_SPACES_ROUTE = "apiV1/v1/studioReservations.listSpaces";
const STAFF_UPSERT_SPACE_ROUTE = "apiV1/v1/studioReservations.staffUpsertSpace";
const SEED_ACTOR = "seed:studio-reservation-spaces";

function parseArgs(argv) {
  const options = {
    projectId: String(process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
    functionsBaseUrl: String(process.env.PORTAL_FUNCTIONS_BASE_URL || DEFAULT_FUNCTIONS_BASE_URL)
      .trim()
      .replace(/\/+$/, ""),
    dryRun: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if ((arg === "--project" || arg === "-p") && argv[index + 1]) {
      options.projectId = String(argv[index + 1]).trim() || options.projectId;
      index += 1;
      continue;
    }
    if ((arg === "--functions-base-url" || arg === "--base-url") && argv[index + 1]) {
      options.functionsBaseUrl = String(argv[index + 1]).trim().replace(/\/+$/, "") || options.functionsBaseUrl;
      index += 1;
    }
  }

  return options;
}

function loadPortalAutomationEnv() {
  const configuredPath = String(process.env.PORTAL_AUTOMATION_ENV_PATH || "").trim();
  const envPath = configuredPath || DEFAULT_PORTAL_AUTOMATION_ENV_PATH;
  if (!envPath || !existsSync(envPath)) return;

  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
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

async function loadSeedInventory() {
  try {
    const module = await import("../lib/studioReservationInventory.js");
    if (!Array.isArray(module.STUDIO_RESERVATION_SPACE_SEED)) {
      throw new Error("STUDIO_RESERVATION_SPACE_SEED export is missing or invalid.");
    }
    return module.STUDIO_RESERVATION_SPACE_SEED;
  } catch (error) {
    throw new Error(
      `Could not load compiled studio reservation inventory. Run \`npm --prefix functions run build\` first. ${
        error?.message || error
      }`
    );
  }
}

async function callPortalRoute(functionsBaseUrl, route, token, body) {
  const response = await fetch(`${functionsBaseUrl}/${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  if (!response.ok || !json?.ok) {
    const message =
      json?.message ||
      json?.error ||
      json?.details?.message ||
      json?.raw ||
      `HTTP ${response.status}`;
    throw new Error(`${route} failed: ${String(message)}`);
  }

  return json.data;
}

function sortByName(items) {
  return [...items].sort((left, right) => String(left.name || left.id).localeCompare(String(right.name || right.id)));
}

function toStaffUpsertPayload(space) {
  return {
    id: space.id,
    slug: space.slug,
    name: space.name,
    category: space.category,
    description: space.description ?? null,
    memberHelpText: space.memberHelpText ?? null,
    bookingMode: space.bookingMode,
    active: space.active !== false,
    capacity: space.capacity ?? null,
    colorToken: space.colorToken ?? null,
    sortOrder: space.sortOrder ?? 0,
    timezone: space.timezone ?? "America/Phoenix",
    resources: Array.isArray(space.resources) ? space.resources : [],
    templates: Array.isArray(space.templates) ? space.templates : [],
  };
}

async function main() {
  loadPortalAutomationEnv();
  const options = parseArgs(process.argv.slice(2));
  const inventory = await loadSeedInventory();

  const minted = await mintStaffIdTokenFromPortalEnv();
  if (!minted.ok || !minted.token) {
    throw new Error(`Could not mint a staff token: ${minted.reason || "unknown auth failure"}`);
  }

  const before = await callPortalRoute(options.functionsBaseUrl, LIST_SPACES_ROUTE, minted.token, {
    includeInactive: true,
  });
  const existingSpaces = Array.isArray(before?.spaces) ? before.spaces : [];
  const existingById = new Map(existingSpaces.map((space) => [space.id, space]));
  const keepIds = new Set(inventory.map((space) => space.id));

  const summary = {
    status: "passed",
    projectId: options.projectId,
    functionsBaseUrl: options.functionsBaseUrl,
    dryRun: options.dryRun,
    generatedDefaultsBeforeSeed: before?.generatedDefaults === true,
    generatedDefaultsAfterSeed: false,
    seededIds: inventory.map((space) => space.id),
    upserted: [],
    retiredLegacy: [],
    authSource: minted.source,
    notes: [
      "Legacy spaces are retired in place instead of hard-deleted so existing historical reservations can still resolve safely.",
      "Inventory writes are routed through the production staff upsert endpoint instead of direct Firestore admin writes.",
    ],
    actor: SEED_ACTOR,
    ranAtIso: new Date().toISOString(),
  };

  for (const space of inventory) {
    summary.upserted.push({
      id: space.id,
      action: existingById.has(space.id) ? "updated" : "created",
      name: space.name,
    });
    if (options.dryRun) continue;
    await callPortalRoute(options.functionsBaseUrl, STAFF_UPSERT_SPACE_ROUTE, minted.token, toStaffUpsertPayload(space));
  }

  for (const existing of sortByName(existingSpaces)) {
    if (keepIds.has(existing.id)) continue;
    summary.retiredLegacy.push({
      id: existing.id,
      name: existing.name || existing.id,
      wasActive: existing.active !== false,
    });
    if (options.dryRun) continue;
    await callPortalRoute(options.functionsBaseUrl, STAFF_UPSERT_SPACE_ROUTE, minted.token, {
      ...toStaffUpsertPayload(existing),
      active: false,
    });
  }

  if (!options.dryRun) {
    const after = await callPortalRoute(options.functionsBaseUrl, LIST_SPACES_ROUTE, minted.token, {
      includeInactive: true,
    });
    const afterSpaces = Array.isArray(after?.spaces) ? after.spaces : [];
    summary.generatedDefaultsAfterSeed = after?.generatedDefaults === true;
    summary.activeIdsAfterSeed = afterSpaces.filter((space) => space.active !== false).map((space) => space.id);
  }

  if (options.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `Seeded ${summary.upserted.length} reservation spaces and retired ${summary.retiredLegacy.length} legacy spaces via ${STAFF_UPSERT_SPACE_ROUTE}.`
    );
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        message: error?.message || String(error),
      },
      null,
      2
    )
  );
  process.exit(1);
});
