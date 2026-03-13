#!/usr/bin/env node

/* eslint-disable no-console */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_PROJECT_ID = "monsoonfire-portal";
const DEFAULT_FUNCTIONS_BASE_URL = "https://us-central1-monsoonfire-portal.cloudfunctions.net";
const DEFAULT_CREDENTIALS_PATH = resolve(process.cwd(), "secrets", "portal", "portal-agent-staff.json");
const DEFAULT_REPORT_JSON = resolve(process.cwd(), "output", "qa", "library-rollout-rollback-drill.json");
const DEFAULT_REPORT_MARKDOWN = resolve(process.cwd(), "output", "qa", "library-rollout-rollback-drill.md");
const DEFAULT_MAX_DURATION_MINUTES = 15;

const PHASES = /** @type {const} */ ([
  "phase_1_read_only",
  "phase_2_member_writes",
  "phase_3_admin_full",
]);

/** @typedef {typeof PHASES[number]} LibraryRolloutPhase */

function phaseLabel(phase) {
  if (phase === "phase_1_read_only") return "Phase 1 (read only)";
  if (phase === "phase_2_member_writes") return "Phase 2 (member writes)";
  if (phase === "phase_3_admin_full") return "Phase 3 (admin full)";
  return String(phase || "unknown");
}

function parsePhase(value, fieldName) {
  const normalized = String(value || "").trim();
  if (PHASES.includes(/** @type {LibraryRolloutPhase} */ (normalized))) {
    return /** @type {LibraryRolloutPhase} */ (normalized);
  }
  throw new Error(`${fieldName} must be one of: ${PHASES.join(", ")}`);
}

function parseArgs(argv) {
  const options = {
    apiKey: String(process.env.PORTAL_FIREBASE_API_KEY || "").trim(),
    projectId: String(process.env.PORTAL_PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
    functionsBaseUrl: String(process.env.PORTAL_FUNCTIONS_BASE_URL || DEFAULT_FUNCTIONS_BASE_URL)
      .trim()
      .replace(/\/+$/, ""),
    credentialsPath: String(process.env.PORTAL_AGENT_STAFF_CREDENTIALS || DEFAULT_CREDENTIALS_PATH).trim(),
    reportJsonPath: String(process.env.PORTAL_LIBRARY_ROLLOUT_DRILL_REPORT_JSON || DEFAULT_REPORT_JSON).trim(),
    reportMarkdownPath: String(
      process.env.PORTAL_LIBRARY_ROLLOUT_DRILL_REPORT_MARKDOWN || DEFAULT_REPORT_MARKDOWN
    ).trim(),
    maxDurationMinutes: Number(
      process.env.PORTAL_LIBRARY_ROLLOUT_DRILL_MAX_DURATION_MINUTES || DEFAULT_MAX_DURATION_MINUTES
    ),
    execute: false,
    skipRestore: false,
    allowPromoteFromPhase1: false,
    rollbackTo: /** @type {LibraryRolloutPhase | null} */ (null),
    notePrefix: String(process.env.PORTAL_LIBRARY_ROLLOUT_DRILL_NOTE_PREFIX || "library rollback drill").trim(),
    asJson: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg || !arg.startsWith("--")) continue;

    if (arg === "--api-key") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --api-key");
      options.apiKey = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--project") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --project");
      options.projectId = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--functions-base-url") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --functions-base-url");
      options.functionsBaseUrl = String(next).trim().replace(/\/+$/, "");
      index += 1;
      continue;
    }
    if (arg === "--credentials") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --credentials");
      options.credentialsPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--report-json") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --report-json");
      options.reportJsonPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--report-markdown") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --report-markdown");
      options.reportMarkdownPath = resolve(process.cwd(), String(next).trim());
      index += 1;
      continue;
    }
    if (arg === "--max-duration-minutes") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --max-duration-minutes");
      options.maxDurationMinutes = Number(next);
      index += 1;
      continue;
    }
    if (arg === "--rollback-to") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --rollback-to");
      options.rollbackTo = parsePhase(next, "--rollback-to");
      index += 1;
      continue;
    }
    if (arg === "--note-prefix") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) throw new Error("Missing value for --note-prefix");
      options.notePrefix = String(next).trim();
      index += 1;
      continue;
    }
    if (arg === "--execute") {
      options.execute = true;
      continue;
    }
    if (arg === "--skip-restore") {
      options.skipRestore = true;
      continue;
    }
    if (arg === "--allow-promote-from-phase1") {
      options.allowPromoteFromPhase1 = true;
      continue;
    }
    if (arg === "--json") {
      options.asJson = true;
      continue;
    }
  }

  if (!options.apiKey) {
    throw new Error("Missing PORTAL_FIREBASE_API_KEY (or pass --api-key).");
  }
  if (!Number.isFinite(options.maxDurationMinutes) || options.maxDurationMinutes <= 0) {
    throw new Error("--max-duration-minutes must be a positive number.");
  }
  return options;
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text.slice(0, 600) };
  }
  return {
    ok: response.ok,
    status: response.status,
    json,
  };
}

function summarizeError(response) {
  if (response.ok) return null;
  return response.json ?? { message: "Request failed with non-JSON payload" };
}

function chooseRollbackTarget(currentPhase) {
  if (currentPhase === "phase_3_admin_full") return "phase_2_member_writes";
  if (currentPhase === "phase_2_member_writes") return "phase_1_read_only";
  return null;
}

function isRolloutBlocked(response) {
  return response.status === 403 && String(response.json?.code || "") === "LIBRARY_ROLLOUT_BLOCKED";
}

function toIso(ms) {
  return new Date(ms).toISOString();
}

function toDurationMinutes(durationMs) {
  return Number((durationMs / 60000).toFixed(2));
}

function makeRouteProbeExpectation(phase) {
  return {
    discoveryShouldPass: true,
    memberWriteBlocked: phase === "phase_1_read_only",
    adminWriteBlocked: phase !== "phase_3_admin_full",
  };
}

function formatMarkdown(summary) {
  const lines = [];
  lines.push("# Library Rollout Rollback Drill");
  lines.push("");
  lines.push(`- status: ${summary.status}`);
  lines.push(`- executed: ${summary.executed ? "yes" : "no"}`);
  lines.push(`- project: ${summary.projectId}`);
  lines.push(`- functionsBaseUrl: ${summary.functionsBaseUrl}`);
  lines.push(`- actor: ${summary.actor.email} (${summary.actor.uid})`);
  lines.push(`- startedAt: ${summary.startedAtIso}`);
  lines.push(`- finishedAt: ${summary.finishedAtIso}`);
  lines.push(`- originalPhase: ${summary.originalPhase || "n/a"}`);
  lines.push(`- rollbackTargetPhase: ${summary.rollbackTargetPhase || "n/a"}`);
  lines.push(`- restoredPhase: ${summary.restoredPhase || "n/a"}`);
  lines.push(`- rollbackDurationMinutes: ${summary.rollback.durationMinutes ?? "n/a"}`);
  lines.push(`- rollbackUnderTarget: ${summary.rollback.withinTarget ? "yes" : "no"}`);
  if (summary.message) lines.push(`- message: ${summary.message}`);
  lines.push("");
  lines.push("## Steps");
  if (summary.steps.length === 0) {
    lines.push("- none");
  } else {
    for (const step of summary.steps) {
      lines.push(
        `- ${step.label}: ${step.status} (${step.durationMs}ms)${
          step.detail ? ` - ${step.detail}` : ""
        }`
      );
    }
  }
  lines.push("");
  lines.push("## Route Probes");
  if (!summary.routeProbes) {
    lines.push("- not executed");
  } else {
    lines.push(
      `- discovery: status=${summary.routeProbes.discovery.status} ok=${summary.routeProbes.discovery.ok}`
    );
    lines.push(
      `- member write: status=${summary.routeProbes.memberWrite.status} blocked=${summary.routeProbes.memberWrite.blockedByRollout}`
    );
    lines.push(
      `- admin write: status=${summary.routeProbes.adminWrite.status} blocked=${summary.routeProbes.adminWrite.blockedByRollout}`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

async function ensureParentDir(pathname) {
  await mkdir(dirname(pathname), { recursive: true });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAtMs = Date.now();

  const rawCreds = await readFile(options.credentialsPath, "utf8");
  const creds = JSON.parse(rawCreds);
  const refreshToken = String(creds.refreshToken || "").trim();
  const uid = String(creds.uid || "").trim();
  const email = String(creds.email || "").trim();

  if (!refreshToken || !uid || !email) {
    throw new Error(`Invalid credentials file at ${options.credentialsPath}`);
  }

  const tokenResp = await requestJson(
    `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(options.apiKey)}`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }).toString(),
    }
  );

  if (!tokenResp.ok || !tokenResp.json?.id_token) {
    throw new Error("Could not mint ID token from refresh token.");
  }

  const idToken = String(tokenResp.json.id_token).trim();
  const headers = {
    Authorization: `Bearer ${idToken}`,
    "content-type": "application/json",
  };
  const routeUrl = `${options.functionsBaseUrl}/apiV1`;

  const steps = [];
  const addStep = (step) => {
    steps.push(step);
  };

  async function callRoute(route, body) {
    return requestJson(`${routeUrl}${route}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
    });
  }

  async function callGetConfig() {
    return callRoute("/v1/library.rollout.get", {});
  }

  async function callSetConfig(phase, note) {
    return callRoute("/v1/library.rollout.set", { phase, note });
  }

  async function measureStep(label, fn) {
    const stepStarted = Date.now();
    try {
      const value = await fn();
      const durationMs = Date.now() - stepStarted;
      addStep({ label, status: "ok", durationMs });
      return value;
    } catch (error) {
      const durationMs = Date.now() - stepStarted;
      const message = error instanceof Error ? error.message : String(error);
      addStep({ label, status: "failed", durationMs, detail: message });
      throw error;
    }
  }

  const firstConfigResp = await measureStep("load current rollout phase", () => callGetConfig());
  if (!firstConfigResp.ok || !firstConfigResp.json?.ok) {
    throw new Error(`Failed to load rollout config (status ${firstConfigResp.status}).`);
  }

  const originalPhase = parsePhase(firstConfigResp.json?.data?.phase, "rollout phase");
  const baselineTarget = chooseRollbackTarget(originalPhase);
  const rollbackTargetPhase = options.rollbackTo || baselineTarget;

  /** @type {LibraryRolloutPhase | null} */
  let currentPhase = originalPhase;
  /** @type {number | null} */
  let rollbackStartedAtMs = null;
  /** @type {number | null} */
  let rollbackFinishedAtMs = null;
  /** @type {any} */
  let routeProbes = null;
  /** @type {string | null} */
  let blockedReason = null;

  const noteRoot = `${options.notePrefix} ${toIso(Date.now())}`;

  if (!options.execute) {
    if (!rollbackTargetPhase) {
      blockedReason =
        "Current phase is phase_1_read_only. Rehearsal write is blocked without --allow-promote-from-phase1 or --rollback-to.";
    }
  } else if (!rollbackTargetPhase) {
    if (!options.allowPromoteFromPhase1) {
      blockedReason =
        "Current phase is phase_1_read_only. Use --allow-promote-from-phase1 to run a promote-then-rollback rehearsal.";
    } else {
      await measureStep("promote phase_1 -> phase_2 for rollback rehearsal", async () => {
        const note = `${noteRoot} promote baseline for rollback rehearsal`;
        const setResp = await callSetConfig("phase_2_member_writes", note);
        if (!setResp.ok || !setResp.json?.ok) {
          throw new Error(`phase_1 -> phase_2 promotion failed (status ${setResp.status})`);
        }
        currentPhase = "phase_2_member_writes";
      });
    }
  }

  if (options.execute && !blockedReason) {
    const targetPhase = parsePhase(
      rollbackTargetPhase || chooseRollbackTarget(currentPhase) || "phase_1_read_only",
      "rollback target phase"
    );

    rollbackStartedAtMs = Date.now();
    await measureStep(`set rollback target ${targetPhase}`, async () => {
      const note = `${noteRoot} rollback drill target=${targetPhase}`;
      const setResp = await callSetConfig(targetPhase, note);
      if (!setResp.ok || !setResp.json?.ok) {
        throw new Error(`set rollback target failed (status ${setResp.status})`);
      }
      currentPhase = targetPhase;
    });

    await measureStep("verify rollback target phase", async () => {
      const getResp = await callGetConfig();
      if (!getResp.ok || !getResp.json?.ok) {
        throw new Error(`verify rollback target failed (status ${getResp.status})`);
      }
      const observed = parsePhase(getResp.json?.data?.phase, "observed rollback phase");
      if (observed !== targetPhase) {
        throw new Error(`Observed phase ${observed} does not match target ${targetPhase}`);
      }
      currentPhase = observed;
    });

    const expected = makeRouteProbeExpectation(targetPhase);
    routeProbes = await measureStep("run rollback safe-state route probes", async () => {
      const discovery = await callRoute("/v1/library.discovery.get", { limit: 4 });
      const memberWrite = await callRoute("/v1/library.loans.checkout", {});
      const adminWrite = await callRoute("/v1/library.items.create", {});

      const payload = {
        discovery: {
          status: discovery.status,
          ok: discovery.ok && discovery.json?.ok === true,
          error: summarizeError(discovery),
        },
        memberWrite: {
          status: memberWrite.status,
          ok: memberWrite.ok && memberWrite.json?.ok === true,
          blockedByRollout: isRolloutBlocked(memberWrite),
          code: String(memberWrite.json?.code || ""),
          error: summarizeError(memberWrite),
        },
        adminWrite: {
          status: adminWrite.status,
          ok: adminWrite.ok && adminWrite.json?.ok === true,
          blockedByRollout: isRolloutBlocked(adminWrite),
          code: String(adminWrite.json?.code || ""),
          error: summarizeError(adminWrite),
        },
      };

      const problems = [];
      if (!payload.discovery.ok && expected.discoveryShouldPass) {
        problems.push("discovery route did not remain available");
      }
      if (payload.memberWrite.blockedByRollout !== expected.memberWriteBlocked) {
        problems.push(
          `member write rollout behavior mismatch (expected blocked=${expected.memberWriteBlocked}, got blocked=${payload.memberWrite.blockedByRollout})`
        );
      }
      if (payload.adminWrite.blockedByRollout !== expected.adminWriteBlocked) {
        problems.push(
          `admin write rollout behavior mismatch (expected blocked=${expected.adminWriteBlocked}, got blocked=${payload.adminWrite.blockedByRollout})`
        );
      }
      if (problems.length > 0) {
        throw new Error(`safe-state checks failed: ${problems.join("; ")}`);
      }
      return payload;
    });
    rollbackFinishedAtMs = Date.now();

    if (!options.skipRestore && currentPhase !== originalPhase) {
      await measureStep(`restore rollout phase to ${originalPhase}`, async () => {
        const note = `${noteRoot} restore original=${originalPhase}`;
        const restoreResp = await callSetConfig(originalPhase, note);
        if (!restoreResp.ok || !restoreResp.json?.ok) {
          throw new Error(`restore phase failed (status ${restoreResp.status})`);
        }
        currentPhase = originalPhase;
      });
    }
  }

  const finishedAtMs = Date.now();
  const rollbackDurationMs =
    rollbackStartedAtMs && rollbackFinishedAtMs ? rollbackFinishedAtMs - rollbackStartedAtMs : null;
  const rollbackDurationMinutes = rollbackDurationMs === null ? null : toDurationMinutes(rollbackDurationMs);
  const withinTarget =
    rollbackDurationMinutes === null ? false : rollbackDurationMinutes <= Number(options.maxDurationMinutes);

  let status = "planned";
  let message = "";
  if (blockedReason) {
    status = "blocked";
    message = blockedReason;
  } else if (options.execute) {
    status = withinTarget ? "passed" : "failed";
    message = withinTarget
      ? `Rollback drill executed and verified within ${options.maxDurationMinutes} minutes.`
      : `Rollback drill exceeded ${options.maxDurationMinutes} minute target.`;
  } else {
    status = "planned";
    message = "Dry run only. Re-run with --execute to apply phase changes and capture timing evidence.";
  }

  const summary = {
    status,
    executed: options.execute && !blockedReason,
    projectId: options.projectId,
    functionsBaseUrl: options.functionsBaseUrl,
    actor: { uid, email },
    startedAtIso: toIso(startedAtMs),
    finishedAtIso: toIso(finishedAtMs),
    originalPhase,
    rollbackTargetPhase: rollbackTargetPhase || null,
    restoredPhase: currentPhase || null,
    maxDurationMinutes: options.maxDurationMinutes,
    rollback: {
      startedAtIso: rollbackStartedAtMs ? toIso(rollbackStartedAtMs) : null,
      finishedAtIso: rollbackFinishedAtMs ? toIso(rollbackFinishedAtMs) : null,
      durationMs: rollbackDurationMs,
      durationMinutes: rollbackDurationMinutes,
      withinTarget,
    },
    routeProbes,
    message,
    steps,
  };

  await ensureParentDir(options.reportJsonPath);
  await ensureParentDir(options.reportMarkdownPath);
  await writeFile(options.reportJsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(options.reportMarkdownPath, formatMarkdown(summary), "utf8");

  if (options.asJson) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    process.stdout.write(`status: ${summary.status}\n`);
    process.stdout.write(`executed: ${summary.executed ? "yes" : "no"}\n`);
    process.stdout.write(`originalPhase: ${summary.originalPhase}\n`);
    process.stdout.write(`rollbackTargetPhase: ${summary.rollbackTargetPhase || "n/a"}\n`);
    process.stdout.write(`restoredPhase: ${summary.restoredPhase || "n/a"}\n`);
    process.stdout.write(
      `rollbackDurationMinutes: ${summary.rollback.durationMinutes ?? "n/a"} (target <= ${summary.maxDurationMinutes})\n`
    );
    process.stdout.write(`jsonReport: ${options.reportJsonPath}\n`);
    process.stdout.write(`markdownReport: ${options.reportMarkdownPath}\n`);
    if (summary.message) {
      process.stdout.write(`${summary.message}\n`);
    }
  }

  if (summary.status === "failed") {
    process.exit(1);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`library-rollout-rollback-drill failed: ${message}`);
  process.exit(1);
});
