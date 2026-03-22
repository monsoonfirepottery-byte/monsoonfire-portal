#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildPlanningPacket, buildPlanningPreparation, loadPlanningGovernance, writeJsonArtifact } from "./lib/planning-control-plane.mjs";
import { LIVE_SWARM_DEFAULT_MODEL, orchestratePlanningLiveSwarm } from "./lib/planning-live-swarm-runner.mjs";
import { stableHash } from "./lib/pst-memory-utils.mjs";
import { hydrateStudioBrainAuthFromPortal } from "./lib/studio-brain-startup-auth.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DEFAULT_BASE_URL = String(process.env.STUDIO_BRAIN_BASE_URL || process.env.STUDIO_BRAIN_MCP_BASE_URL || "http://192.168.1.226:8787").trim().replace(/\/+$/, "");

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readFlag(name, fallback = "", args = process.argv) {
  const index = args.findIndex((arg) => arg === name);
  if (index < 0) return fallback;
  return clean(args[index + 1]) || fallback;
}

function readNumberFlag(name, fallback, args = process.argv) {
  const raw = readFlag(name, "", args);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", reject);
  });
}

async function readPayload(args = process.argv) {
  const inputFlag = readFlag("--input", "", args);
  const markdownFlag = readFlag("--markdown-input", "", args);
  const stdinMarkdown = args.includes("--stdin-markdown");
  const reviewMode = readFlag("--review-mode", "swarm", args);
  const draftSource = readFlag("--draft-source", "", args);
  const requestedBy = clean(process.env.PLANNING_COUNCIL_REQUESTED_BY || readFlag("--requested-by", "codex-thread", args)) || "codex-thread";
  if (stdinMarkdown) {
    return {
      sourceType: "draft-plan",
      requestedBy,
      draftPlan: await readStdin(),
      reviewMode,
      draftSource: draftSource || "explicit_draft",
    };
  }
  if (markdownFlag) {
    return {
      sourceType: "draft-plan",
      requestedBy,
      draftPlan: readFileSync(resolve(REPO_ROOT, markdownFlag), "utf8"),
      reviewMode,
      draftSource: draftSource || "explicit_draft",
    };
  }
  return {
    ...JSON.parse(readFileSync(resolve(REPO_ROOT, inputFlag || "scripts/fixtures/planning/security-sensitive-request.json"), "utf8")),
    reviewMode,
    requestedBy,
    ...(draftSource ? { draftSource } : {}),
  };
}

async function postPlanningSubmit(baseUrl, token, body) {
  const response = await fetch(`${baseUrl}/api/planning/submit`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.message || `Planning submit failed with HTTP ${response.status}.`);
  }
  return payload;
}

function stringifyFragment(value) {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function deriveObjectiveFromDraft(draftText) {
  const draft = clean(draftText);
  if (!draft) return "";
  const headingMatch = /(?:^|\n)##\s+Objective\s*\n([\s\S]*?)(?:\n##\s+|\n#\s+|$)/i.exec(draft);
  if (headingMatch?.[1]) {
    const normalized = headingMatch[1]
      .split(/\r?\n/)
      .map((line) => clean(line.replace(/^[-*]\s*/, "")))
      .filter(Boolean)
      .join(" ");
    if (normalized) return normalized;
  }
  const inlineMatch = /(?:^|\n)Objective:\s*(.+)$/im.exec(draft);
  if (inlineMatch?.[1]) return clean(inlineMatch[1]);
  const titleMatch = /(?:^|\n)#\s+(.+)$/.exec(draft);
  return clean(titleMatch?.[1]);
}

export function buildDraftBinding(payload, overrides = {}) {
  const metadata = payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {};
  const sourceType =
    clean(overrides.submittedSourceType || metadata.submittedSourceType || payload?.sourceType)
    || (payload?.draftPlan ? "draft-plan" : payload?.planningBrief ? "planning-brief" : "raw-request");
  const draftText = stringifyFragment(payload?.draftPlan);
  const objective =
    clean(overrides.submittedObjective || metadata.submittedObjective || payload?.docket?.objective || payload?.request)
    || deriveObjectiveFromDraft(draftText);
  const requestBasis = {
    sourceType,
    request: clean(payload?.request),
    draftPlan: draftText,
    planningBrief: stringifyFragment(payload?.planningBrief),
    docket: payload?.docket ?? {},
    requestedBy: clean(payload?.requestedBy),
  };
  const requestId =
    clean(overrides.requestId || metadata.requestId)
    || `planning_req_${stableHash(JSON.stringify(requestBasis), 18)}`;
  const draftFingerprint =
    clean(overrides.draftFingerprint || metadata.draftFingerprint)
    || stableHash(JSON.stringify({ ...requestBasis, objective }), 24);
  const preparedRunId = clean(overrides.preparedRunId || metadata.preparedRunId);
  const reportCorrelationId =
    clean(overrides.reportCorrelationId || metadata.reportCorrelationId)
    || (preparedRunId
      ? `planning_report_${stableHash(`${requestId}|${preparedRunId}|${draftFingerprint}`, 16)}`
      : "");
  return {
    requestId,
    draftFingerprint,
    preparedRunId,
    submittedObjective: objective,
    submittedSourceType: sourceType,
    reportCorrelationId,
    canaryGate: clean(overrides.canaryGate || metadata.canaryGate) || "pending",
  };
}

function withPayloadMetadata(payload, integrity) {
  return {
    ...payload,
    metadata: {
      ...(payload?.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
      requestId: integrity.requestId,
      draftFingerprint: integrity.draftFingerprint,
      submittedObjective: integrity.submittedObjective,
      submittedSourceType: integrity.submittedSourceType,
      canaryGate: integrity.canaryGate || "pending",
      ...(clean(integrity.preparedRunId) ? { preparedRunId: integrity.preparedRunId } : {}),
      ...(clean(integrity.reportCorrelationId) ? { reportCorrelationId: integrity.reportCorrelationId } : {}),
    },
  };
}

function withExternalSwarmControlPlane(externalSwarmArtifacts, integrity) {
  return {
    ...(externalSwarmArtifacts && typeof externalSwarmArtifacts === "object" ? externalSwarmArtifacts : {}),
    controlPlane: {
      ...(externalSwarmArtifacts?.controlPlane && typeof externalSwarmArtifacts.controlPlane === "object"
        ? externalSwarmArtifacts.controlPlane
        : {}),
      requestId: integrity.requestId,
      draftFingerprint: integrity.draftFingerprint,
      preparedRunId: integrity.preparedRunId,
      submittedObjective: integrity.submittedObjective,
      submittedSourceType: integrity.submittedSourceType,
      reportCorrelationId: integrity.reportCorrelationId,
    },
    swarmRun: {
      ...(externalSwarmArtifacts?.swarmRun && typeof externalSwarmArtifacts.swarmRun === "object"
        ? externalSwarmArtifacts.swarmRun
        : {}),
      requestId: integrity.requestId,
      draftFingerprint: integrity.draftFingerprint,
      preparedRunId: integrity.preparedRunId,
      submittedObjective: integrity.submittedObjective,
      reportCorrelationId: integrity.reportCorrelationId,
    },
  };
}

export function stampReportIntegrity(report, integrity, { canaryGate = "pending", fallbackReason = "" } = {}) {
  const packet = report?.packet && typeof report.packet === "object" ? report.packet : {};
  const wrapperIntegrity = {
    ...(report?.wrapperIntegrity && typeof report.wrapperIntegrity === "object" ? report.wrapperIntegrity : {}),
    ...(packet?.wrapperIntegrity && typeof packet.wrapperIntegrity === "object" ? packet.wrapperIntegrity : {}),
    requestId: integrity.requestId,
    draftFingerprint: integrity.draftFingerprint,
    preparedRunId: clean(integrity.preparedRunId || report?.preparedRunId || packet?.preparedRunId),
    submittedObjective: integrity.submittedObjective,
    submittedSourceType: integrity.submittedSourceType,
    reportCorrelationId:
      clean(integrity.reportCorrelationId)
      || clean(report?.wrapperIntegrity?.reportCorrelationId)
      || clean(packet?.wrapperIntegrity?.reportCorrelationId),
    canaryGate,
  };
  return {
    ...report,
    preparedRunId: wrapperIntegrity.preparedRunId || clean(report?.preparedRunId),
    wrapperIntegrity,
    ...(fallbackReason && !clean(report?.fallbackReason) ? { fallbackReason } : {}),
    packet: {
      ...packet,
      preparedRunId: wrapperIntegrity.preparedRunId || clean(packet?.preparedRunId),
      wrapperIntegrity,
    },
  };
}

export function validateReportIntegrity(report, expected) {
  const packet = report?.packet && typeof report.packet === "object" ? report.packet : {};
  const wrapperIntegrity = {
    ...(report?.wrapperIntegrity && typeof report.wrapperIntegrity === "object" ? report.wrapperIntegrity : {}),
    ...(packet?.wrapperIntegrity && typeof packet.wrapperIntegrity === "object" ? packet.wrapperIntegrity : {}),
  };
  const actual = {
    requestId: clean(wrapperIntegrity.requestId),
    draftFingerprint: clean(wrapperIntegrity.draftFingerprint),
    preparedRunId: clean(wrapperIntegrity.preparedRunId || report?.preparedRunId || packet?.preparedRunId),
    submittedObjective: clean(wrapperIntegrity.submittedObjective || packet?.objective || report?.objective),
    packetObjective: clean(packet?.objective),
    reportCorrelationId: clean(wrapperIntegrity.reportCorrelationId),
  };
  const issues = [];
  if (clean(expected.requestId) && actual.requestId !== clean(expected.requestId)) {
    issues.push(`requestId mismatch (${actual.requestId || "missing"} !== ${expected.requestId})`);
  }
  if (clean(expected.draftFingerprint) && actual.draftFingerprint !== clean(expected.draftFingerprint)) {
    issues.push(`draftFingerprint mismatch (${actual.draftFingerprint || "missing"} !== ${expected.draftFingerprint})`);
  }
  if (clean(expected.preparedRunId) && actual.preparedRunId !== clean(expected.preparedRunId)) {
    issues.push(`preparedRunId mismatch (${actual.preparedRunId || "missing"} !== ${expected.preparedRunId})`);
  }
  if (clean(expected.submittedObjective)) {
    if (actual.submittedObjective !== clean(expected.submittedObjective)) {
      issues.push(`submittedObjective mismatch (${actual.submittedObjective || "missing"} !== ${expected.submittedObjective})`);
    }
    if (actual.packetObjective && actual.packetObjective !== clean(expected.submittedObjective)) {
      issues.push(`packet objective mismatch (${actual.packetObjective} !== ${expected.submittedObjective})`);
    }
  }
  return {
    ok: issues.length === 0,
    issues,
    actual,
  };
}

function mergeArtifactRefs(packet, artifactRefs) {
  const existing = Array.isArray(packet.artifactRefs) ? packet.artifactRefs : [];
  const merged = [...existing, ...artifactRefs];
  packet.artifactRefs = merged.filter((entry, index) => {
    const key = JSON.stringify(entry);
    return merged.findIndex((candidate) => JSON.stringify(candidate) === key) === index;
  });
}

function deterministicSwarmConfig(payload, args = process.argv) {
  const current = payload && typeof payload === "object" && payload.swarmConfig && typeof payload.swarmConfig === "object" ? payload.swarmConfig : {};
  return {
    ...current,
    runtime: "deterministic",
    executionMode: "deterministic",
    maxCritiqueCycles: Number(current.maxCritiqueCycles ?? readNumberFlag("--max-critique-cycles", 2, args)),
  };
}

function liveSwarmConfig(payload, args = process.argv) {
  const current = payload && typeof payload === "object" && payload.swarmConfig && typeof payload.swarmConfig === "object" ? payload.swarmConfig : {};
  return {
    ...current,
    runtime: "codex-local",
    executionMode: "live",
    depthProfile: clean(current.depthProfile) || readFlag("--depth-profile", "deepest", args),
    maxCritiqueCycles: Number(current.maxCritiqueCycles ?? readNumberFlag("--max-critique-cycles", 2, args)),
  };
}

function buildPreparationIntegrity(preparation, payload, seedIntegrity) {
  const metadata = preparation?.docket?.metadata && typeof preparation.docket.metadata === "object" ? preparation.docket.metadata : {};
  const base = buildDraftBinding(payload, {
    ...seedIntegrity,
    requestId: clean(metadata.requestId || seedIntegrity.requestId),
    draftFingerprint: clean(metadata.draftFingerprint || stableHash(preparation?.canonicalDraftMarkdown || payload?.draftPlan || payload?.request || "", 24)),
    preparedRunId: clean(metadata.preparedRunId || preparation?.preparedRunId),
    submittedObjective: clean(metadata.submittedObjective || preparation?.docket?.objective || seedIntegrity.submittedObjective),
    submittedSourceType: clean(metadata.submittedSourceType || preparation?.docket?.sourceType || seedIntegrity.submittedSourceType),
    reportCorrelationId: clean(metadata.reportCorrelationId || seedIntegrity.reportCorrelationId),
  });
  return {
    ...base,
    canaryGate: "prepared",
  };
}

async function runLivePath(payload, { baseUrl, token, model, integrity, args = process.argv }) {
  const prepareBody = withPayloadMetadata({
    ...payload,
    submissionStage: "prepare",
    reviewMode: "swarm",
    swarmConfig: liveSwarmConfig(payload, args),
  }, integrity);
  const prepared = await postPlanningSubmit(baseUrl, token, prepareBody);
  const preparation = prepared.preparation;
  const preparedIntegrity = buildPreparationIntegrity(preparation, payload, integrity);
  const externalSwarmArtifacts = withExternalSwarmControlPlane(await orchestratePlanningLiveSwarm({
    preparation,
    apiKey: clean(process.env.OPENAI_API_KEY),
    model,
    repoRoot: REPO_ROOT,
  }), preparedIntegrity);
  const completeBody = withPayloadMetadata({
    ...payload,
    submissionStage: "complete",
    preparedRunId: preparation.preparedRunId,
    reviewMode: "swarm",
    swarmConfig: liveSwarmConfig(payload, args),
    externalSwarmArtifacts,
  }, preparedIntegrity);
  const completed = await postPlanningSubmit(baseUrl, token, completeBody);
  return stampReportIntegrity({
    schema: "planning-live-swarm-report.v1",
    mode: clean(externalSwarmArtifacts?.swarmRun?.runtime) === "codex-cli" ? "live_codex_cli" : "live",
    preparedRunId: preparation.preparedRunId,
    ...completed.bundle,
  }, preparedIntegrity);
}

async function runDeterministicApiFallback(payload, { baseUrl, token, fallbackReason, integrity, args = process.argv }) {
  const requestPayload = withPayloadMetadata({
    ...payload,
    submissionStage: "single_pass",
    reviewMode: "deterministic",
    swarmConfig: deterministicSwarmConfig(payload, args),
  }, integrity);
  const result = await postPlanningSubmit(baseUrl, token, requestPayload);
  return stampReportIntegrity({
    schema: "planning-live-swarm-report.v1",
    mode: "deterministic_api_fallback",
    fallbackReason,
    ...result.bundle,
  }, integrity);
}

async function runLocalLiveFallback(payload, artifactRefs, { fallbackReason, model, integrity, args = process.argv }) {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const preparedInput = withPayloadMetadata({
    ...payload,
    reviewMode: "swarm",
    swarmConfig: liveSwarmConfig(payload, args),
  }, integrity);
  const preparation = buildPlanningPreparation(preparedInput, governance);
  const preparedIntegrity = buildPreparationIntegrity(preparation, payload, integrity);
  const externalSwarmArtifacts = withExternalSwarmControlPlane(await orchestratePlanningLiveSwarm({
    preparation,
    apiKey: clean(process.env.OPENAI_API_KEY),
    model,
    repoRoot: REPO_ROOT,
  }), preparedIntegrity);
  return stampReportIntegrity({
    schema: "planning-live-swarm-report.v1",
    mode: "local_live_swarm_fallback",
    fallbackReason,
    ...buildPlanningPacket(preparedInput, governance, {
      artifactRefs,
      externalSwarmArtifacts,
      memoryPack: preparation.sharedMemoryPack,
    }),
  }, preparedIntegrity);
}

function runLocalDeterministicFallback(payload, artifactRefs, fallbackReason, integrity, args = process.argv) {
  const governance = loadPlanningGovernance(REPO_ROOT);
  const requestPayload = withPayloadMetadata({
    ...payload,
    reviewMode: "deterministic",
    swarmConfig: deterministicSwarmConfig(payload, args),
  }, integrity);
  return stampReportIntegrity({
    schema: "planning-live-swarm-report.v1",
    mode: "local_deterministic_fallback",
    fallbackReason,
    ...buildPlanningPacket(requestPayload, governance, {
      artifactRefs,
    }),
  }, integrity);
}

async function main(args = process.argv) {
  const emitJson = args.includes("--json");
  const model = readFlag("--model", LIVE_SWARM_DEFAULT_MODEL, args);
  const payload = await readPayload(args);
  const packetRelativePath = "artifacts/planning/human-arbitration-packet.generated.json";
  const reportRelativePath = "output/planning/planning-live-swarm-report.generated.json";
  const artifactRefs = [
    { kind: "packet-artifact", path: resolve(REPO_ROOT, packetRelativePath) },
    { kind: "live-swarm-report", path: resolve(REPO_ROOT, reportRelativePath) },
  ];
  const baseIntegrity = buildDraftBinding(payload);

  let report;
  let liveFailure = "";
  const reviewMode = clean(payload.reviewMode) || "swarm";
  if (reviewMode !== "deterministic") {
    const hydration = await hydrateStudioBrainAuthFromPortal({ repoRoot: REPO_ROOT }).catch((error) => ({
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    }));
    const token = clean(process.env.STUDIO_BRAIN_AUTH_TOKEN || process.env.STUDIO_BRAIN_ID_TOKEN || process.env.STUDIO_BRAIN_MCP_ID_TOKEN);
    if (hydration.ok && token) {
      try {
        report = await runLivePath(payload, {
          baseUrl: DEFAULT_BASE_URL,
          token,
          model,
          integrity: baseIntegrity,
          args,
        });
        const expected = buildDraftBinding(payload, {
          ...baseIntegrity,
          preparedRunId: clean(report?.preparedRunId || report?.wrapperIntegrity?.preparedRunId),
          draftFingerprint: clean(report?.wrapperIntegrity?.draftFingerprint || baseIntegrity.draftFingerprint),
          reportCorrelationId: clean(report?.wrapperIntegrity?.reportCorrelationId || baseIntegrity.reportCorrelationId),
          submittedObjective: clean(report?.wrapperIntegrity?.submittedObjective || baseIntegrity.submittedObjective),
        });
        const validation = validateReportIntegrity(report, expected);
        if (!validation.ok) {
          report = null;
          liveFailure = `Live council canary gate failed: ${validation.issues.join(" | ")}`;
        }
      } catch (error) {
        liveFailure = error instanceof Error ? error.message : String(error);
        try {
          report = await runDeterministicApiFallback(payload, {
            baseUrl: DEFAULT_BASE_URL,
            token,
            fallbackReason: liveFailure,
            integrity: baseIntegrity,
            args,
          });
        } catch (fallbackError) {
          liveFailure = `${liveFailure} | API fallback failed: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`;
        }
      }
    } else {
      liveFailure = "Studio Brain auth was unavailable for live swarm execution.";
    }
  }

  if (!report && reviewMode !== "deterministic") {
    try {
      report = await runLocalLiveFallback(payload, artifactRefs, {
        fallbackReason: liveFailure || "Studio Brain live submission was unavailable; ran local live swarm fallback instead.",
        model,
        integrity: baseIntegrity,
        args,
      });
    } catch (error) {
      liveFailure = liveFailure
        ? `${liveFailure} | Local live fallback failed: ${error instanceof Error ? error.message : String(error)}`
        : `Local live fallback failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  if (!report) {
    report = runLocalDeterministicFallback(
      payload,
      artifactRefs,
      liveFailure || "Live swarm execution was not available.",
      baseIntegrity,
      args,
    );
  }

  const finalIntegrity = buildDraftBinding(payload, {
    ...baseIntegrity,
    requestId: clean(report?.wrapperIntegrity?.requestId || baseIntegrity.requestId),
    draftFingerprint: clean(report?.wrapperIntegrity?.draftFingerprint || baseIntegrity.draftFingerprint),
    preparedRunId: clean(report?.preparedRunId || report?.wrapperIntegrity?.preparedRunId || report?.packet?.preparedRunId),
    submittedObjective: clean(report?.wrapperIntegrity?.submittedObjective || baseIntegrity.submittedObjective),
    submittedSourceType: clean(report?.wrapperIntegrity?.submittedSourceType || baseIntegrity.submittedSourceType),
    reportCorrelationId: clean(report?.wrapperIntegrity?.reportCorrelationId || baseIntegrity.reportCorrelationId),
  });
  let validation = validateReportIntegrity(report, finalIntegrity);
  if (!validation.ok && reviewMode !== "deterministic" && !String(report?.mode || "").includes("deterministic")) {
    const mismatchReason = `Live council canary gate failed: ${validation.issues.join(" | ")}`;
    report = runLocalDeterministicFallback(payload, artifactRefs, mismatchReason, finalIntegrity, args);
    validation = validateReportIntegrity(report, finalIntegrity);
  }
  if (!validation.ok) {
    throw new Error(`Planning live swarm integrity gate failed: ${validation.issues.join(" | ")}`);
  }

  report = stampReportIntegrity(report, finalIntegrity, { canaryGate: "matched" });
  mergeArtifactRefs(report.packet, artifactRefs);
  const packetPath = writeJsonArtifact(REPO_ROOT, packetRelativePath, report.packet);
  const reportPath = writeJsonArtifact(REPO_ROOT, reportRelativePath, report);

  if (emitJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`planning-live-swarm packet: ${report.packet.packetId}\n`);
    process.stdout.write(`mode: ${report.mode}\n`);
    process.stdout.write(`go/no-go: ${report.packet.goNoGoRecommendation}\n`);
    process.stdout.write(`why: ${report.packet.goNoGoWhy}\n`);
    process.stdout.write(`canary: ${report.wrapperIntegrity.canaryGate}\n`);
    if (clean(report.fallbackReason)) process.stdout.write(`fallback: ${report.fallbackReason}\n`);
    process.stdout.write(`packet artifact: ${packetPath}\n`);
    process.stdout.write(`report: ${reportPath}\n`);
  }
}

const isDirectRun = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isDirectRun) {
  try {
    await main(process.argv);
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
