#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { mintStaffIdTokenFromPortalEnv, normalizeBearer } from "./lib/firebase-auth-token.mjs";
import { resolveStudioBrainBaseUrlFromEnv } from "./studio-brain-url-resolution.mjs";

const DEFAULT_GUARD_REPORT = resolve(process.cwd(), "output", "open-memory", "ingest-guard-live.json");
const DEFAULT_SUPERVISOR_STATE = resolve(process.cwd(), "output", "open-memory", "ops-supervisor-state.json");
const DEFAULT_SUPERVISOR_REPORT = resolve(process.cwd(), "output", "open-memory", "ops-supervisor-latest.json");
const DEFAULT_SUPERVISOR_EVENT_LOG = resolve(process.cwd(), "output", "open-memory", "ops-supervisor-events.jsonl");

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = String(argv[i] ?? "");
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).trim().toLowerCase();
    if (key.includes("=")) {
      const [rawKey, ...rest] = key.split("=");
      flags[rawKey.trim().toLowerCase()] = rest.join("=");
      continue;
    }
    const next = argv[i + 1];
    if (next && !String(next).startsWith("--")) {
      flags[key] = String(next);
      i += 1;
    } else {
      flags[key] = "true";
    }
  }
  return flags;
}

function readBool(flags, key, fallback = false) {
  const raw = String(flags[key] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function readInt(flags, key, fallback, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = String(flags[key] ?? "").trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function readString(flags, key, fallback = "") {
  const raw = String(flags[key] ?? "").trim();
  return raw || fallback;
}

function readGuardReport(reportPath, { includeHistory = false, guardHistoryLimit = 5 } = {}) {
  if (!existsSync(reportPath)) {
    return { ok: false, reason: "missing-report", reportPath, report: null };
  }
  try {
    const raw = readFileSync(reportPath, "utf8");
    const report = JSON.parse(raw);
    if (report && typeof report === "object" && !includeHistory) {
      const history = Array.isArray(report.history) ? report.history : [];
      const latest = report.latest && typeof report.latest === "object" ? report.latest : null;
      const compactCycle = (cycle) => {
        if (!cycle || typeof cycle !== "object") return cycle;
        const phases = Array.isArray(cycle.phases) ? cycle.phases : [];
        return {
          cycle: Number(cycle.cycle ?? 0) || null,
          ok: cycle.ok === true,
          startedAt: typeof cycle.startedAt === "string" ? cycle.startedAt : null,
          finishedAt: typeof cycle.finishedAt === "string" ? cycle.finishedAt : null,
          adaptive: cycle.adaptive ?? null,
          profile: cycle.profile ?? null,
          aggregate: cycle.aggregate ?? null,
          phases: phases.map((phase) => ({
            phase: String(phase?.phase ?? ""),
            skipped: phase?.skipped === true,
            skipReason: phase?.skipReason ?? null,
            pressureDeferred: phase?.pressureDeferred === true,
            dryRunOk: phase?.dryRun?.ok === true,
            dryRunStopReason: phase?.dryRun?.stopReason ?? null,
            applyOk: phase?.apply?.ok === true,
            applyStopReason: phase?.apply?.stopReason ?? null,
            fallbackCaptureApplied: phase?.apply?.fallbackCaptureApplied === true,
            experimentalAdaptiveReason: phase?.experimentalAdaptive?.reason ?? null,
          })),
          forcedReindex: cycle.forcedReindex ?? null,
        };
      };
      report.history = history.slice(-Math.max(0, guardHistoryLimit)).map(compactCycle);
      report.historyTruncated = history.length > report.history.length;
      report.historyCount = history.length;
      if (latest && report.history.length === 0) {
        report.history = [compactCycle(latest)];
      }
    }
    return { ok: true, reason: "", reportPath, report };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      reportPath,
      report: null,
    };
  }
}

function readSupervisorState(statePath) {
  if (!existsSync(statePath)) {
    return { ok: false, reason: "missing-supervisor-state", statePath, state: null };
  }
  try {
    const raw = readFileSync(statePath, "utf8");
    const state = JSON.parse(raw);
    return { ok: true, reason: "", statePath, state };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      statePath,
      state: null,
    };
  }
}

function readSupervisorReport(reportPath) {
  if (!existsSync(reportPath)) {
    return { ok: false, reason: "missing-supervisor-report", reportPath, report: null };
  }
  try {
    const raw = readFileSync(reportPath, "utf8");
    const report = JSON.parse(raw);
    return { ok: true, reason: "", reportPath, report };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      reportPath,
      report: null,
    };
  }
}

function readSupervisorEventStats(eventLogPath, sampleSize = 100) {
  if (!existsSync(eventLogPath)) {
    return { ok: false, reason: "missing-supervisor-event-log", eventLogPath, stats: null };
  }
  try {
    const raw = readFileSync(eventLogPath, "utf8");
    const lines = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const recent = lines.slice(-Math.max(1, sampleSize));
    const parsedRows = [];
    let critical = 0;
    let warn = 0;
    let actionful = 0;
    let webhookSent = 0;
    let lastCriticalAtMs = null;
    for (const line of recent) {
      try {
        const row = JSON.parse(line);
        parsedRows.push(row);
        const severity = String(row.severity ?? "ok");
        if (severity === "critical") {
          critical += 1;
          const parsedAt = Date.parse(String(row.generatedAt ?? ""));
          if (Number.isFinite(parsedAt)) {
            lastCriticalAtMs = Math.max(lastCriticalAtMs ?? 0, parsedAt);
          }
        }
        if (severity === "warn") warn += 1;
        if (Array.isArray(row.actions) && row.actions.length > 0) actionful += 1;
        if (row.webhook && row.webhook.sent === true) webhookSent += 1;
      } catch {}
    }
    return {
      ok: true,
      reason: "",
      eventLogPath,
      stats: {
        sampleSize: recent.length,
        critical,
        warn,
        actionful,
        webhookSent,
        criticalRecent3: parsedRows
          .slice(-3)
          .filter((row) => String(row?.severity ?? "ok") === "critical").length,
        latestSeverity: String(parsedRows[parsedRows.length - 1]?.severity ?? "ok"),
        lastCriticalAgeSeconds:
          typeof lastCriticalAtMs === "number" && Number.isFinite(lastCriticalAtMs)
            ? Math.max(0, Math.round((Date.now() - lastCriticalAtMs) / 1000))
            : null,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      eventLogPath,
      stats: null,
    };
  }
}

async function fetchPressure(baseUrl, timeoutMs) {
  const minted = await mintStaffIdTokenFromPortalEnv({
    env: process.env,
    defaultCredentialsPath: resolve(process.cwd(), "secrets", "portal", "portal-agent-staff.json"),
    preferRefreshToken: true,
  });
  if (!minted.ok || !minted.token) {
    return {
      ok: false,
      status: 0,
      message: `token-mint-failed:${minted.reason || "unknown"}`,
      pressure: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      authorization: normalizeBearer(minted.token),
    };
    const adminToken = String(process.env.STUDIO_BRAIN_ADMIN_TOKEN || "").trim();
    if (adminToken) {
      headers["x-studio-brain-admin-token"] = adminToken;
    }
    const response = await fetch(`${baseUrl}/api/memory/pressure`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { raw: text };
    }
    return {
      ok: response.ok,
      status: response.status,
      message: String(payload?.message ?? ""),
      pressure: payload?.pressure ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      message: `pressure-request-failed:${error instanceof Error ? error.message : String(error)}`,
      pressure: null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function countProcesses(pattern) {
  const result = spawnSync("bash", ["-lc", `pgrep -af ${JSON.stringify(pattern)}`], {
    encoding: "utf8",
  });
  const lines = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^\d+\s+node\b/.test(line));
  return lines.length;
}

function computeGuardStaleSeconds(guardSnapshot) {
  const updatedAtRaw = guardSnapshot?.report?.updatedAt;
  if (typeof updatedAtRaw !== "string" || !updatedAtRaw.trim()) return null;
  const parsed = Date.parse(updatedAtRaw);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

function computeIsoAgeSeconds(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round((Date.now() - parsed) / 1000));
}

function buildStatus({
  pressureSnapshot,
  guardSnapshot,
  supervisorSnapshot,
  supervisorReportSnapshot,
  supervisorEventsSnapshot,
  processSnapshot,
  maxGuardStaleSeconds,
  maxSupervisorReportStaleSeconds,
  maxHistoricalCriticalAgeSeconds,
}) {
  const alerts = [];
  const actions = [];
  let level = "ok";

  if (processSnapshot.guardProcesses <= 0) {
    alerts.push("ingest-guard process not detected");
    actions.push("restart memory-guard tmux session");
    level = "warn";
  }
  if (Number(processSnapshot.contextCaptureProcesses ?? 0) > 1) {
    alerts.push(`multiple experimental capture workers active (${Number(processSnapshot.contextCaptureProcesses ?? 0)})`);
    actions.push("check for overlapping fallback capture runs and enforce bounded max-runtime");
    if (level === "ok") level = "warn";
  }

  const pressure = pressureSnapshot.pressure;
  if (pressure) {
    const activeImports = Number(pressure.activeImportRequests ?? 0);
    const maxImports = Number(pressure.thresholds?.maxActiveImportsBeforeBackfill ?? 0);
    if (maxImports > 0 && activeImports >= maxImports) {
      alerts.push(`import pressure high (${activeImports}/${maxImports}); backfill deferrals are expected`);
      actions.push("stay in ingest-priority mode; avoid manual backfill pushes");
      if (level === "ok") level = "warn";
    }
    const activeQueries = Number(
      pressure.activeQueryRequests ?? Number(pressure.activeSearchRequests ?? 0) + Number(pressure.activeContextRequests ?? 0)
    );
    const maxQueries = Number(pressure.thresholds?.maxActiveQueryRequests ?? 0);
    if (maxQueries > 0 && activeQueries >= maxQueries) {
      alerts.push(`memory query pressure high (${activeQueries}/${maxQueries}); query degradation or shedding may apply`);
      actions.push("tag non-urgent callers with queryLane=bulk and reduce search/context fanout");
      if (level === "ok") level = "warn";
    }
  } else if (!pressureSnapshot.ok) {
    alerts.push(`pressure endpoint unavailable (${pressureSnapshot.message || "unknown"})`);
    actions.push("check studio-brain auth/token path and /api/memory/pressure route");
    if (level === "ok") level = "warn";
  }

  const latest = guardSnapshot.report?.latest ?? null;
  if (latest && latest.ok === false) {
    alerts.push("latest guard cycle reported failure");
    actions.push("inspect output/open-memory/ingest-guard-live.log for non-deferred failures");
    level = "critical";
  }
  if (latest?.aggregate) {
    const rerankInput = Number(latest.aggregate.experimentalRerankRowsInput ?? 0);
    const rerankRetained = Number(latest.aggregate.experimentalRerankRowsRetained ?? 0);
    const rerankAvgScore = Number(latest.aggregate.experimentalRerankAvgScore ?? 0);
    const noveltySuppressed = Number(latest.aggregate.experimentalNoveltySuppressedCandidates ?? 0);
    const noveltyAvgScore = Number(latest.aggregate.experimentalNoveltyAvgScore ?? 0);
    const searchAttempted = Number(latest.aggregate.experimentalSearchQueriesAttempted ?? 0);
    const searchDeferred = Number(latest.aggregate.experimentalSearchQueriesDeferred ?? 0);
    const searchDegradationRate = Number(latest.aggregate.experimentalSearchDegradationRate ?? 0);
    const noveltyCandidates =
      Number(latest.aggregate.experimentalRelationshipCandidates ?? 0) +
      Number(latest.aggregate.experimentalMotifsDetected ?? 0) +
      noveltySuppressed;
    const noveltySuppressionRate = noveltySuppressed / Math.max(1, noveltyCandidates);
    if (rerankInput >= 30 && rerankRetained <= 0) {
      alerts.push("experimental rerank retained zero rows despite input volume");
      actions.push("inspect experimental index thresholds and query quality");
      if (level !== "critical") level = "warn";
    } else if (rerankRetained > 0 && rerankAvgScore < 0.18) {
      alerts.push(`experimental rerank quality low (avgScore=${rerankAvgScore.toFixed(3)})`);
      actions.push("tune rerank weights and search seed extraction");
      if (level === "ok") level = "warn";
    }
    if (noveltySuppressed >= 8 && noveltySuppressionRate >= 0.45) {
      alerts.push(`experimental novelty suppression high (${noveltySuppressed}, rate=${noveltySuppressionRate.toFixed(2)})`);
      actions.push("increase search diversity and inspect duplicate-key pressure in recent synthetic context rows");
      if (level === "ok") level = "warn";
    }
    if (rerankRetained > 0 && noveltyAvgScore <= 0.2) {
      alerts.push(`experimental novelty score low (avgNovelty=${noveltyAvgScore.toFixed(3)})`);
      actions.push("review dedupe window and novelty weighting for aggressive duplicate suppression");
      if (level === "ok") level = "warn";
    }
    if (searchAttempted >= 2 && searchDegradationRate >= 0.7) {
      alerts.push(
        `experimental search degradation is high (rate=${searchDegradationRate.toFixed(2)}, deferred=${searchDeferred}/${searchAttempted})`
      );
      actions.push("increase query caps or reduce experimental search fanout during ingest spikes");
      if (level === "ok") level = "warn";
    }
    const adaptiveExp = latest.adaptive?.experimental ?? null;
    if (adaptiveExp) {
      const edgeConfidence = Number(adaptiveExp.edgeConfidence ?? 0);
      const motifScore = Number(adaptiveExp.motifScore ?? 0);
      if (edgeConfidence >= 0.84 || motifScore >= 2.4) {
        alerts.push(`experimental thresholds are very strict (edge=${edgeConfidence.toFixed(3)}, motif=${motifScore.toFixed(2)})`);
        actions.push("confirm index throughput is acceptable or relax adaptive threshold ceilings");
        if (level === "ok") level = "warn";
      } else if (edgeConfidence > 0 && edgeConfidence <= 0.5 && motifScore > 0 && motifScore <= 1.05) {
        alerts.push(`experimental thresholds are very permissive (edge=${edgeConfidence.toFixed(3)}, motif=${motifScore.toFixed(2)})`);
        actions.push("monitor for noisy motif/relationship captures and raise adaptive floors if needed");
        if (level === "ok") level = "warn";
      }
    }
  }

  const guardStaleSeconds = computeGuardStaleSeconds(guardSnapshot);
  if (guardStaleSeconds !== null && guardStaleSeconds > maxGuardStaleSeconds) {
    alerts.push(`guard report stale (${guardStaleSeconds}s > ${maxGuardStaleSeconds}s)`);
    actions.push("let supervisor restart memory-guard or restart memory-guard tmux session manually");
    if (level === "ok") level = "warn";
  }

  if (supervisorSnapshot.state) {
    const brainFails = Number(supervisorSnapshot.state.brainConsecutiveHealthFailures ?? 0);
    const guardStale = Number(supervisorSnapshot.state.guardConsecutiveStale ?? 0);
    if (brainFails > 0) {
      alerts.push(`studio-brain health failure streak: ${brainFails}`);
      actions.push("watch supervisor for studio-brain auto-restart");
      if (level === "ok") level = "warn";
    }
    if (guardStale > 0) {
      alerts.push(`guard stale streak: ${guardStale}`);
      actions.push("watch supervisor for memory-guard auto-restart");
      if (level === "ok") level = "warn";
    }
  } else if (!supervisorSnapshot.ok) {
    alerts.push(`supervisor state unavailable (${supervisorSnapshot.reason})`);
    actions.push("verify memory-supervisor session and state file output/open-memory/ops-supervisor-state.json");
    if (level === "ok") level = "warn";
  }

  const supervisorReportAgeSeconds = computeIsoAgeSeconds(supervisorReportSnapshot.report?.generatedAt);
  if (!supervisorReportSnapshot.ok) {
    alerts.push(`supervisor report unavailable (${supervisorReportSnapshot.reason})`);
    actions.push("verify memory-supervisor session and output/open-memory/ops-supervisor-latest.json");
    if (level === "ok") level = "warn";
  } else if (supervisorReportAgeSeconds !== null && supervisorReportAgeSeconds > maxSupervisorReportStaleSeconds) {
    alerts.push(`supervisor report stale (${supervisorReportAgeSeconds}s > ${maxSupervisorReportStaleSeconds}s)`);
    actions.push("check memory-supervisor loop health");
    if (level === "ok") level = "warn";
  }

  const lastSupervisorActions = Array.isArray(supervisorReportSnapshot.report?.actions)
    ? supervisorReportSnapshot.report.actions.map((value) => String(value))
    : [];
  if (lastSupervisorActions.some((value) => /failed-to-start/i.test(value))) {
    alerts.push("supervisor reported start failures");
    actions.push("inspect output/open-memory/ops-supervisor.log for launch errors");
    level = "critical";
  }

  if (supervisorEventsSnapshot.stats) {
    const criticalEvents = Number(supervisorEventsSnapshot.stats.critical ?? 0);
    const sampled = Number(supervisorEventsSnapshot.stats.sampleSize ?? 0);
    const criticalRecent3 = Number(supervisorEventsSnapshot.stats.criticalRecent3 ?? 0);
    if (criticalRecent3 > 0) {
      alerts.push(`supervisor critical events in last 3 cycles: ${criticalRecent3}`);
      actions.push("inspect output/open-memory/ops-supervisor-events.jsonl and ops-supervisor.log");
      level = "critical";
    } else if (criticalEvents > 0) {
      const lastCriticalAgeSeconds = Number(supervisorEventsSnapshot.stats.lastCriticalAgeSeconds ?? -1);
      if (lastCriticalAgeSeconds >= 0 && lastCriticalAgeSeconds <= maxHistoricalCriticalAgeSeconds) {
        alerts.push(`supervisor had recent critical events: ${criticalEvents}/${sampled} (last ${lastCriticalAgeSeconds}s ago)`);
        actions.push("review recent supervisor incidents for trend");
        if (level === "ok") level = "warn";
      }
    }
  }

  if (!alerts.length) {
    actions.push("continue ingest and let guard backfill opportunistically");
  }

  return {
    level,
    alerts,
    actions,
    summary:
      level === "critical"
        ? "intervention-needed"
        : level === "warn"
          ? "degraded-but-managing"
          : "healthy",
  };
}

function printHuman(snapshot) {
  const lines = [];
  lines.push("Open Memory Ops Dashboard");
  lines.push(`Generated: ${snapshot.generatedAt}`);
  lines.push(`Status: ${snapshot.status.level} (${snapshot.status.summary})`);
  lines.push(`Base URL: ${snapshot.baseUrl}`);
  lines.push(`Guard report: ${snapshot.guard.reportPath}`);
  lines.push(`Supervisor state: ${snapshot.supervisor.statePath}`);
  lines.push(`Supervisor report: ${snapshot.supervisorReport.reportPath}`);
  lines.push(`Supervisor event log: ${snapshot.supervisorEvents.eventLogPath}`);
  lines.push(
    `Processes: guard=${snapshot.processes.guardProcesses}, converge=${snapshot.processes.convergeProcesses}, contextIndexer=${snapshot.processes.contextIndexerProcesses}, contextCapture=${snapshot.processes.contextCaptureProcesses}, import=${snapshot.processes.importProcesses}, mailWorkers=${snapshot.processes.mailWorkerProcesses}`
  );
  if (snapshot.pressure.pressure) {
    const p = snapshot.pressure.pressure;
    lines.push(
      `Pressure: activeImports=${Number(p.activeImportRequests ?? 0)}, activeBackfills=${Number(
        p.activeBackfillRequests ?? 0
      )}, activeQueries=${Number(
        p.activeQueryRequests ?? Number(p.activeSearchRequests ?? 0) + Number(p.activeContextRequests ?? 0)
      )}, thresholdImports=${Number(p.thresholds?.maxActiveImportsBeforeBackfill ?? 0)}, thresholdQueries=${Number(
        p.thresholds?.maxActiveQueryRequests ?? 0
      )}`
    );
  } else {
    lines.push(`Pressure: unavailable (${snapshot.pressure.message || "unknown"})`);
  }
  const latest = snapshot.guard.report?.latest ?? null;
  const staleSeconds = snapshot.guardStaleSeconds;
  if (staleSeconds !== null && staleSeconds !== undefined) {
    lines.push(`Guard report age: ${staleSeconds}s`);
  }
  if (latest) {
    lines.push(`Latest guard cycle: cycle=${latest.cycle ?? "n/a"}, ok=${String(latest.ok ?? "n/a")}`);
    if (latest.profile?.mode) {
      lines.push(`Guard profile: ${latest.profile.mode}`);
    }
    if (latest.aggregate) {
      lines.push(
        `Experimental context: motifs=${Number(latest.aggregate.experimentalMotifsDetected ?? 0)}, decisionFlowMotifs=${Number(
          latest.aggregate.experimentalDecisionFlowMotifsDetected ?? 0
        )}, bridgeHubMotifs=${Number(latest.aggregate.experimentalBridgeHubMotifsDetected ?? 0)}, relationshipCandidates=${Number(
          latest.aggregate.experimentalRelationshipCandidates ?? 0
        )}, edgeCaptures=${Number(latest.aggregate.experimentalRelationshipEdgesCaptured ?? 0)}, captures=${Number(
          latest.aggregate.experimentalCapturesWritten ?? 0
        )}`
      );
      lines.push(
        `Experimental retrieval: rerankInput=${Number(latest.aggregate.experimentalRerankRowsInput ?? 0)}, rerankRetained=${Number(
          latest.aggregate.experimentalRerankRowsRetained ?? 0
        )}, signalDominant=${Number(latest.aggregate.experimentalRerankSignalDominantRows ?? 0)}, avgSeedOverlap=${Number(
          latest.aggregate.experimentalRerankAvgSeedOverlap ?? 0
        )}, avgScore=${Number(latest.aggregate.experimentalRerankAvgScore ?? 0)}, degradedQueries=${Number(
          latest.aggregate.experimentalSearchQueriesDegraded ?? 0
        )}, deferredQueries=${Number(latest.aggregate.experimentalSearchQueriesDeferred ?? 0)}, degradationRate=${Number(
          latest.aggregate.experimentalSearchDegradationRate ?? 0
        )}`
      );
      lines.push(
        `Experimental novelty: suppressed=${Number(
          latest.aggregate.experimentalNoveltySuppressedCandidates ?? 0
        )}, reusedKeys=${Number(latest.aggregate.experimentalNoveltyReusedKeys ?? 0)}, avgNovelty=${Number(
          latest.aggregate.experimentalNoveltyAvgScore ?? 0
        )}`
      );
    }
    if (latest.adaptive?.experimental) {
      const a = latest.adaptive.experimental;
      lines.push(
        `Experimental adaptive: searchLimit=${Number(a.searchLimit ?? 0)}, seedLimit=${Number(
          a.searchSeedLimit ?? 0
        )}, maxSearchQueries=${Number(a.maxSearchQueries ?? 0)}, fallbackWrites=${Number(
          a.fallbackMaxWrites ?? 0
        )}, rerankTopK=${Number(a.rerankTopK ?? 0)}, edgeConfidence=${Number(a.edgeConfidence ?? 0)}, motifScore=${Number(
          a.motifScore ?? 0
        )}`
      );
    }
    const experimentalPhase = Array.isArray(latest.phases)
      ? latest.phases.find((row) => String(row?.phase ?? "") === "experimental-context")
      : null;
    if (experimentalPhase?.experimentalAdaptive?.reason) {
      lines.push(`Experimental adaptive reason: ${experimentalPhase.experimentalAdaptive.reason}`);
    }
  } else {
    lines.push("Latest guard cycle: unavailable");
  }
  const supervisorReportAge = computeIsoAgeSeconds(snapshot.supervisorReport.report?.generatedAt);
  if (supervisorReportAge !== null) {
    lines.push(`Supervisor report age: ${supervisorReportAge}s`);
  }
  const supervisorActions = Array.isArray(snapshot.supervisorReport.report?.actions)
    ? snapshot.supervisorReport.report.actions.map((value) => String(value))
    : [];
  if (supervisorActions.length > 0) {
    lines.push("Last supervisor actions:");
    for (const action of supervisorActions) {
      lines.push(`- ${action}`);
    }
  }
  if (snapshot.supervisor.state) {
    const s = snapshot.supervisor.state;
    lines.push(
      `Supervisor counters: brainRecoveries=${Number(s.totalBrainRecoveries ?? 0)}, guardRecoveries=${Number(
        s.totalGuardRecoveries ?? 0
      )}, brainRestarts=${Number(s.totalBrainRestarts ?? 0)}, guardRestarts=${Number(s.totalGuardRestarts ?? 0)}, alerts=${Number(
        s.totalAlerts ?? 0
      )}`
    );
  }
  if (snapshot.supervisorEvents.stats) {
    const s = snapshot.supervisorEvents.stats;
    lines.push(
      `Supervisor recent events: sample=${s.sampleSize}, warn=${s.warn}, critical=${s.critical}, actionful=${s.actionful}, webhookSent=${s.webhookSent}, lastCriticalAgeSeconds=${s.lastCriticalAgeSeconds ?? "n/a"}`
    );
  }
  if (snapshot.status.alerts.length > 0) {
    lines.push("Alerts:");
    for (const alert of snapshot.status.alerts) {
      lines.push(`- ${alert}`);
    }
  }
  if (snapshot.status.actions.length > 0) {
    lines.push("Recommended actions:");
    for (const action of snapshot.status.actions) {
      lines.push(`- ${action}`);
    }
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, Math.max(0, ms));
  });
}

async function collectSnapshot({
  baseUrl,
  guardReportPath,
  supervisorStatePath,
  supervisorReportPath,
  supervisorEventLogPath,
  timeoutMs,
  includeProcesses,
  includeGuardHistory,
  guardHistoryLimit,
  maxGuardStaleSeconds,
  maxSupervisorReportStaleSeconds,
  maxHistoricalCriticalAgeSeconds,
}) {
  const guard = readGuardReport(guardReportPath, {
    includeHistory: includeGuardHistory,
    guardHistoryLimit,
  });
  const supervisor = readSupervisorState(supervisorStatePath);
  const supervisorReport = readSupervisorReport(supervisorReportPath);
  const supervisorEvents = readSupervisorEventStats(supervisorEventLogPath);
  const pressure = await fetchPressure(baseUrl, timeoutMs);
  const processes = includeProcesses
    ? {
        guardProcesses: countProcesses("open-memory-ingest-guard.mjs"),
        convergeProcesses: countProcesses("open-memory-backfill-converge.mjs"),
        contextIndexerProcesses: countProcesses("open-memory-context-experimental-index.mjs"),
        contextCaptureProcesses: countProcesses("open-memory-context-experimental-capture.mjs"),
        importProcesses: countProcesses("open-memory.mjs import"),
        mailWorkerProcesses: countProcesses("open-memory-mail-import.mjs"),
      }
    : {
        guardProcesses: 0,
        convergeProcesses: 0,
        contextIndexerProcesses: 0,
        contextCaptureProcesses: 0,
        importProcesses: 0,
        mailWorkerProcesses: 0,
      };

  const staleSeconds = computeGuardStaleSeconds(guard);
  const status = buildStatus({
    pressureSnapshot: pressure,
    guardSnapshot: guard,
    supervisorSnapshot: supervisor,
    supervisorReportSnapshot: supervisorReport,
    supervisorEventsSnapshot: supervisorEvents,
    processSnapshot: processes,
    maxGuardStaleSeconds,
    maxSupervisorReportStaleSeconds,
    maxHistoricalCriticalAgeSeconds,
  });

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    baseUrl,
    guard,
    supervisor,
    supervisorReport,
    supervisorEvents,
    guardStaleSeconds: staleSeconds,
    pressure,
    processes,
    status,
  };
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const printJson = readBool(flags, "json", false);
  const includeProcesses = readBool(flags, "include-processes", true);
  const includeGuardHistory = readBool(flags, "include-guard-history", false);
  const guardHistoryLimit = readInt(flags, "guard-history-limit", 5, { min: 0, max: 5000 });
  const watch = readBool(flags, "watch", false);
  const intervalMs = readInt(flags, "interval-ms", 30_000, { min: 1_000, max: 3_600_000 });
  const iterations = readInt(flags, "iterations", 0, { min: 0, max: 1_000_000 });
  const timeoutMs = readInt(flags, "timeout-ms", 8000, { min: 1000, max: 120000 });
  const maxGuardStaleSeconds = readInt(flags, "max-guard-stale-seconds", 420, { min: 30, max: 86_400 });
  const maxSupervisorReportStaleSeconds = readInt(flags, "max-supervisor-report-stale-seconds", 120, { min: 10, max: 86_400 });
  const maxHistoricalCriticalAgeSeconds = readInt(flags, "max-historical-critical-age-seconds", 1800, {
    min: 10,
    max: 7_200_000,
  });
  const baseUrl = readString(
    flags,
    "base-url",
    String(process.env.STUDIO_BRAIN_BASE_URL || resolveStudioBrainBaseUrlFromEnv({ env: process.env }) || "http://192.168.1.226:8787")
  ).replace(/\/$/, "");
  const guardReportPath = readString(flags, "guard-report", DEFAULT_GUARD_REPORT);
  const supervisorStatePath = readString(flags, "supervisor-state", DEFAULT_SUPERVISOR_STATE);
  const supervisorReportPath = readString(flags, "supervisor-report", DEFAULT_SUPERVISOR_REPORT);
  const supervisorEventLogPath = readString(flags, "supervisor-event-log", DEFAULT_SUPERVISOR_EVENT_LOG);

  let remaining = iterations;
  let first = true;
  while (true) {
    if (watch && !first && intervalMs > 0) {
      await sleep(intervalMs);
    }
    first = false;
    const snapshot = await collectSnapshot({
      baseUrl,
      guardReportPath,
      supervisorStatePath,
      supervisorReportPath,
      supervisorEventLogPath,
      timeoutMs,
      includeProcesses,
      includeGuardHistory,
      guardHistoryLimit,
      maxGuardStaleSeconds,
      maxSupervisorReportStaleSeconds,
      maxHistoricalCriticalAgeSeconds,
    });
    if (printJson) {
      process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
    } else {
      printHuman(snapshot);
      if (watch) {
        process.stdout.write("\n");
      }
    }
    if (!watch) break;
    if (remaining > 0) {
      remaining -= 1;
      if (remaining <= 0) break;
    }
  }
}

main().catch((error) => {
  process.stderr.write(`open-memory-ops-dashboard failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
