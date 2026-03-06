#!/usr/bin/env node
import { resolveStudioBrainBaseUrlFromEnv } from "./_studioBrainBaseUrl.mjs";

function parseArgs(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw?.startsWith("--")) continue;
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
      continue;
    }
    flags[key] = "true";
  }
  return flags;
}

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function boolFlag(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  const text = String(value).trim().toLowerCase();
  if (!text) return fallback;
  if (text === "0" || text === "false" || text === "no" || text === "off") return false;
  return true;
}

function intFlag(value, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.trunc(numeric));
}

function normalizeBearer(value) {
  const token = String(value ?? "").trim();
  if (!token) return "";
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const baseUrl = String(flags["base-url"] ?? resolveStudioBrainBaseUrlFromEnv({ env: process.env })).replace(/\/$/, "");
  const authorization = normalizeBearer(
    flags.auth ?? process.env.STUDIO_BRAIN_AUTH_TOKEN ?? process.env.STUDIO_BRAIN_ID_TOKEN ?? ""
  );
  const adminToken = String(flags["admin-token"] ?? process.env.STUDIO_BRAIN_ADMIN_TOKEN ?? "").trim();
  const everySeconds = intFlag(flags["every-seconds"] ?? process.env.OPEN_MEMORY_AUTOMATION_EVERY_SECONDS, 300);
  const runOnce = boolFlag(flags.once, false);
  const dryRun = boolFlag(flags["dry-run"], false);
  const payloadBase = {
    tenantId: flags["tenant-id"] ? String(flags["tenant-id"]).trim() : undefined,
    query: flags.query ? String(flags.query).trim() : undefined,
    states: flags.states ? parseCsv(flags.states) : [],
    lanes: flags.lanes ? parseCsv(flags.lanes) : [],
    loopKeys: flags["loop-keys"] ? parseCsv(flags["loop-keys"]) : [],
    limit: intFlag(flags.limit, 50),
    incidentLimit: intFlag(flags["incident-limit"], 30),
    maxActions: intFlag(flags["max-actions"], 30),
    applyActions: dryRun ? false : boolFlag(flags["apply-actions"], true),
    actorId: flags["actor-id"] ? String(flags["actor-id"]).trim() : undefined,
    includeBatchPayload: true,
    dispatch: boolFlag(flags.dispatch, true),
    webhookUrl: flags["webhook-url"] ? String(flags["webhook-url"]).trim() : undefined,
    applyPriorities: flags["apply-priorities"] ? parseCsv(flags["apply-priorities"]) : undefined,
    allowedActions: flags["allowed-actions"] ? parseCsv(flags["allowed-actions"]) : undefined,
  };

  const headers = {
    "content-type": "application/json",
  };
  if (authorization) headers.authorization = authorization;
  if (adminToken) headers["x-studio-brain-admin-token"] = adminToken;

  const tick = async () => {
    const idempotencyKey = `runner-${new Date().toISOString().slice(0, 16)}`;
    const payload = {
      ...payloadBase,
      idempotencyKey,
    };
    const response = await fetch(`${baseUrl}/api/memory/loops/automation-tick`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    if (!response.ok) {
      const message = typeof parsed?.message === "string" ? parsed.message : `HTTP ${response.status}`;
      throw new Error(`${message} (${response.status})`);
    }
    process.stdout.write(
      `${JSON.stringify(
        {
          at: new Date().toISOString(),
          ok: true,
          result: parsed,
        },
        null,
        2
      )}\n`
    );
  };

  if (runOnce) {
    await tick();
    return;
  }

  for (;;) {
    try {
      await tick();
    } catch (error) {
      process.stderr.write(`automation-runner tick failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await new Promise((resolve) => setTimeout(resolve, everySeconds * 1000));
  }
}

main().catch((error) => {
  process.stderr.write(`open-memory-automation-runner failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
