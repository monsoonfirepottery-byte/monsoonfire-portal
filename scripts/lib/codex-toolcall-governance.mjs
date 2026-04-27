import { auditWindowsCommandShape, recommendedWindowsCommandPatterns } from "./codex-command-shape-guardrails.mjs";

const SYNTHETIC_STARTUP_TOOL_NAMES = new Set([
  "codex-startup-preflight",
  "codex-doctor",
  "codex-startup-scorecard",
]);

const LIVE_STARTUP_TOOL_NAMES = new Set([
  "codex-desktop",
  "codex-shell",
  "codex-worktree",
]);

const STARTUP_AUTH_REASON_CODES = new Set([
  "missing_token",
  "expired_token",
  "transport_unreachable",
  "timeout",
]);

const OUTPUT_BLOAT_PATTERNS = [
  /\bcontext window\b/i,
  /\bmax output\b/i,
  /\btoo much output\b/i,
  /\btoo large\b/i,
  /\btruncated\b/i,
  /\bmax buffer\b/i,
  /\btoken limit\b/i,
];

const EMPTY_OUTPUT_PATTERNS = [
  /\bempty output\b/i,
  /\bnull output\b/i,
  /\bno output\b/i,
  /\bempty-result\b/i,
];

const PATH_FAILURE_PATTERNS = [
  /\benoent\b/i,
  /\bno such file\b/i,
  /\bpath not found\b/i,
  /\bfile not found\b/i,
  /\bcannot find path\b/i,
];

const COMMAND_SHAPE_PATTERN_BY_FINDING = Object.freeze({
  "rg-glob-backslashes": ['rg -n --glob "scripts/*.mjs" "startup" .'],
  "rg-glob-path-like": ['rg -n "startup" scripts'],
  "node-e-import-without-module": [
    'node --input-type=module -e "import fs from \\"node:fs\\"; console.log(fs.existsSync(\\"package.json\\"))"',
    "Move the snippet into a checked-in `.mjs` helper when the command will be retried.",
  ],
  "get-content-json-without-raw": ["Get-Content -Raw .codex/toolcalls.ndjson | ConvertFrom-Json"],
});

function clean(value) {
  return String(value ?? "").trim();
}

function getStartupContext(entry) {
  return entry?.context?.startup && typeof entry.context.startup === "object" ? entry.context.startup : {};
}

function getStartupPacket(entry) {
  const startup = getStartupContext(entry);
  return startup?.startupPacket && typeof startup.startupPacket === "object" ? startup.startupPacket : {};
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toMs(value) {
  if (!value) return null;
  const parsed = new Date(value);
  const millis = parsed.getTime();
  return Number.isFinite(millis) ? millis : null;
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = clean(value);
    const hash = normalized.toLowerCase();
    if (!normalized || seen.has(hash)) continue;
    seen.add(hash);
    output.push(normalized);
  }
  return output;
}

function readNestedString(source, path) {
  let current = source;
  for (const segment of path) {
    if (!current || typeof current !== "object") return "";
    current = current[segment];
  }
  return clean(current);
}

export function extractRetryGovernor(entry) {
  const context = entry?.context && typeof entry.context === "object" ? entry.context : {};
  const governor =
    (entry?.retryGovernor && typeof entry.retryGovernor === "object" ? entry.retryGovernor : null) ||
    (context?.retryGovernor && typeof context.retryGovernor === "object" ? context.retryGovernor : null);
  if (!governor) return null;

  const signature = clean(governor.signature);
  const action = clean(governor.action);
  const burstCount = toFiniteNumber(governor.burstCount);
  const burstThreshold = toFiniteNumber(governor.burstThreshold);
  const windowMinutes = toFiniteNumber(governor.windowMinutes);
  const normalized = {
    enabled: governor.enabled !== false,
    signature:
      signature ||
      `${clean(entry?.tool) || "unknown"}::${clean(entry?.action) || "unknown"}::${clean(entry?.errorType) || "none"}`,
    burstCount: burstCount != null && burstCount >= 0 ? burstCount : null,
    burstThreshold: burstThreshold != null && burstThreshold >= 0 ? burstThreshold : null,
    windowMinutes: windowMinutes != null && windowMinutes >= 0 ? windowMinutes : null,
    triggered: governor.triggered === true,
    action: action || null,
  };

  if (
    normalized.enabled === true &&
    normalized.triggered === false &&
    normalized.burstCount == null &&
    normalized.burstThreshold == null &&
    normalized.windowMinutes == null &&
    !normalized.action
  ) {
    return null;
  }

  return normalized;
}

export function summarizeRetryGovernorSignals(entries) {
  const governedEntries = (entries || []).filter((entry) => extractRetryGovernor(entry));
  const triggeredEntries = governedEntries.filter((entry) => extractRetryGovernor(entry)?.triggered);
  const bySignature = new Map();

  for (const entry of triggeredEntries) {
    const governor = extractRetryGovernor(entry);
    const signature =
      clean(governor?.signature) ||
      `${clean(entry?.tool) || "unknown"}::${clean(entry?.action) || "unknown"}::${clean(entry?.errorType) || "none"}`;
    if (!bySignature.has(signature)) {
      bySignature.set(signature, {
        signature,
        triggeredEntries: 0,
        maxBurstCount: null,
        burstThreshold: null,
        windowMinutes: null,
        lastTriggeredAtIso: null,
        actions: new Set(),
      });
    }
    const item = bySignature.get(signature);
    item.triggeredEntries += 1;
    if (Number.isFinite(governor?.burstCount)) {
      item.maxBurstCount = Math.max(item.maxBurstCount ?? 0, Number(governor.burstCount));
    }
    if (Number.isFinite(governor?.burstThreshold)) {
      item.burstThreshold = Number(governor.burstThreshold);
    }
    if (Number.isFinite(governor?.windowMinutes)) {
      item.windowMinutes = Number(governor.windowMinutes);
    }
    if (!item.lastTriggeredAtIso || (toMs(entry?.tsIso) ?? 0) > (toMs(item.lastTriggeredAtIso) ?? 0)) {
      item.lastTriggeredAtIso = clean(entry?.tsIso);
    }
    if (governor?.action) {
      item.actions.add(governor.action);
    }
  }

  const topTriggeredSignatures = Array.from(bySignature.values())
    .map((entry) => ({
      signature: entry.signature,
      triggeredEntries: entry.triggeredEntries,
      maxBurstCount: entry.maxBurstCount,
      burstThreshold: entry.burstThreshold,
      windowMinutes: entry.windowMinutes,
      lastTriggeredAtIso: entry.lastTriggeredAtIso,
      actions: Array.from(entry.actions).sort(),
    }))
    .sort(
      (left, right) =>
        right.triggeredEntries - left.triggeredEntries ||
        (right.maxBurstCount ?? 0) - (left.maxBurstCount ?? 0) ||
        String(left.signature).localeCompare(String(right.signature))
    );

  return {
    entriesWithGovernor: governedEntries.length,
    triggeredEntries: triggeredEntries.length,
    triggeredUniqueSignatures: bySignature.size,
    topTriggeredSignatures: topTriggeredSignatures.slice(0, 6),
  };
}

export function extractCommandFromContext(context = {}) {
  return uniqueStrings([
    readNestedString(context, ["command"]),
    readNestedString(context, ["commandLine"]),
    readNestedString(context, ["shellCommand"]),
    readNestedString(context, ["shell", "command"]),
    readNestedString(context, ["exec", "command"]),
    readNestedString(context, ["execution", "command"]),
    readNestedString(context, ["request", "command"]),
    readNestedString(context, ["process", "command"]),
  ])[0] || "";
}

export function extractCommandShape(entry) {
  const context = entry?.context && typeof entry.context === "object" ? entry.context : {};
  const raw = context?.commandShape && typeof context.commandShape === "object" ? context.commandShape : null;
  if (!raw) return null;
  const findings = Array.isArray(raw.findings)
    ? raw.findings
        .map((finding) => ({
          id: clean(finding?.id),
          severity: clean(finding?.severity) || "warn",
          message: clean(finding?.message),
          suggestion: clean(finding?.suggestion),
        }))
        .filter((finding) => finding.id || finding.message)
    : [];
  return {
    command: clean(raw.command),
    taskClass: clean(raw.taskClass),
    findingIds: uniqueStrings([
      ...(Array.isArray(raw.findingIds) ? raw.findingIds : []),
      ...findings.map((finding) => finding.id),
    ]),
    findings,
    repeatSignatureCount: Math.max(0, Math.round(Number(raw.repeatSignatureCount || 0))),
    triggered: raw.triggered === true,
    recommendation: clean(raw.recommendation),
    safePatterns: uniqueStrings(Array.isArray(raw.safePatterns) ? raw.safePatterns : []),
  };
}

export function extractStartupArtifactRepair(entry) {
  const startup = getStartupContext(entry);
  const raw = startup?.localArtifactRepair && typeof startup.localArtifactRepair === "object"
    ? startup.localArtifactRepair
    : null;
  if (!raw && startup?.localArtifactRepairApplied !== true) return null;
  return {
    repaired: startup?.localArtifactRepairApplied === true || raw?.repaired === true,
    reason: clean(raw?.reason),
    source: clean(raw?.source),
    capturedFrom: clean(raw?.capturedFrom),
  };
}

function isStartupObservationEntry(entry) {
  const tool = clean(entry?.tool);
  const startup = getStartupContext(entry);
  return tool && (SYNTHETIC_STARTUP_TOOL_NAMES.has(tool) || LIVE_STARTUP_TOOL_NAMES.has(tool) || Object.keys(startup).length > 0);
}

function inferObservationClass(entry) {
  const packet = getStartupPacket(entry);
  const explicit = clean(packet?.observationClass || getStartupContext(entry)?.observationClass).toLowerCase();
  if (explicit === "live" || explicit === "synthetic") return explicit;
  const tool = clean(entry?.tool);
  if (LIVE_STARTUP_TOOL_NAMES.has(tool)) return "live";
  if (SYNTHETIC_STARTUP_TOOL_NAMES.has(tool)) return "synthetic";
  return "synthetic";
}

function startupObservationIdentity(entry, index = 0) {
  const startup = getStartupContext(entry);
  const packet = getStartupPacket(entry);
  const observationClass = inferObservationClass(entry);
  const observationKey =
    clean(packet?.observationKey) ||
    clean(startup?.observationKey) ||
    (
      clean(startup?.threadId) && clean(startup?.rolloutPath)
        ? `${clean(startup.threadId)}|${clean(startup.rolloutPath)}`
        : ""
    );
  if (observationKey) return `${observationClass}:${observationKey}`;
  const tsIso = clean(entry?.tsIso);
  if (tsIso) return `${observationClass}:${tsIso}:${clean(entry?.tool)}:${clean(entry?.action)}`;
  return `${observationClass}:raw:${index}`;
}

function entryTsMs(entry) {
  return toMs(entry?.tsIso) ?? 0;
}

export function summarizeStartupObservationCoverage(entries = []) {
  const rawStartupEntries = (entries || []).filter((entry) => isStartupObservationEntry(entry));
  const syntheticRawRows = rawStartupEntries.filter((entry) => inferObservationClass(entry) === "synthetic").length;
  const liveRawRows = rawStartupEntries.filter((entry) => inferObservationClass(entry) === "live").length;
  const deduped = new Map();

  rawStartupEntries.forEach((entry, index) => {
    const identity = startupObservationIdentity(entry, index);
    const existing = deduped.get(identity);
    if (!existing || entryTsMs(entry) >= entryTsMs(existing)) {
      deduped.set(identity, entry);
    }
  });

  const uniqueEntries = Array.from(deduped.values());
  const uniqueSyntheticEntries = uniqueEntries.filter((entry) => inferObservationClass(entry) === "synthetic");
  const uniqueLiveEntries = uniqueEntries.filter((entry) => inferObservationClass(entry) === "live");
  const syntheticDuplicateObservationCount = Math.max(0, syntheticRawRows - uniqueSyntheticEntries.length);
  const liveDuplicateObservationCount = Math.max(0, liveRawRows - uniqueLiveEntries.length);

  return {
    rawStartupEntries: rawStartupEntries.length,
    uniqueEntries,
    uniqueSyntheticEntries,
    uniqueLiveEntries,
    syntheticRawRows,
    liveRawRows,
    syntheticUniqueObservations: uniqueSyntheticEntries.length,
    liveUniqueObservations: uniqueLiveEntries.length,
    syntheticDuplicateObservationCount,
    liveDuplicateObservationCount,
    duplicateObservationCount: rawStartupEntries.length - uniqueEntries.length,
  };
}

function inferCommandTaskClass(findingIds = []) {
  if (findingIds.some((id) => id.startsWith("rg-glob"))) return "search";
  if (findingIds.includes("get-content-json-without-raw")) return "json-parse";
  if (findingIds.includes("node-e-import-without-module")) return "inline-script";
  return "command";
}

function recommendedPatternsForFindings(findingIds = []) {
  const explicitPatterns = uniqueStrings(
    findingIds.flatMap((id) => COMMAND_SHAPE_PATTERN_BY_FINDING[id] || [])
  );
  if (explicitPatterns.length > 0) return explicitPatterns;
  return recommendedWindowsCommandPatterns().map((entry) => clean(entry.safePattern)).filter(Boolean);
}

export function enrichCommandShapeContext(payload, recentEntries = []) {
  const context = payload?.context && typeof payload.context === "object" ? payload.context : {};
  const existing = extractCommandShape({ context });
  const command = clean(existing?.command || extractCommandFromContext(context));
  const findings = command ? auditWindowsCommandShape(command) : [];
  const findingIds = uniqueStrings([
    ...(existing?.findingIds || []),
    ...findings.map((finding) => finding.id),
  ]);

  if (!command || findingIds.length === 0) {
    return payload;
  }

  const signature = `${clean(payload?.tool) || "unknown"}::${clean(payload?.action) || "unknown"}::${clean(payload?.errorType) || "none"}`;
  const recentMatchingFailures = (recentEntries || []).filter((entry) => {
    if (!entry || entry.ok !== false) return false;
    const entrySignature = `${clean(entry?.tool) || "unknown"}::${clean(entry?.action) || "unknown"}::${clean(entry?.errorType) || "none"}`;
    const tsMs = toMs(entry?.tsIso);
    const payloadTsMs = toMs(payload?.tsIso);
    if (payloadTsMs == null || tsMs == null) return false;
    return entrySignature === signature && payloadTsMs - tsMs <= 15 * 60 * 1000;
  }).length;
  const repeatSignatureCount = recentMatchingFailures + (payload?.ok === false ? 1 : 0);
  const taskClass = clean(existing?.taskClass || inferCommandTaskClass(findingIds)) || "command";
  const triggered = existing?.triggered === true || (payload?.ok === false && repeatSignatureCount >= 2);
  const recommendation =
    clean(existing?.recommendation) ||
    (triggered
      ? taskClass === "inline-script"
        ? "Stop retrying the inline command as written; move the logic into a checked-in `.mjs` or `.ps1` helper and rerun the helper instead."
        : "Stop retrying the same Windows command shape; replace it with the safe pattern before the next attempt."
      : "");

  return {
    ...payload,
    context: {
      ...context,
      commandShape: {
        command,
        taskClass,
        findingIds,
        findings: findings.length > 0 ? findings : existing?.findings || [],
        repeatSignatureCount,
        triggered,
        recommendation,
        safePatterns: uniqueStrings([
          ...(existing?.safePatterns || []),
          ...recommendedPatternsForFindings(findingIds),
        ]),
      },
    },
  };
}

function buildFrictionResult(kind, signature, recommendation, entry, extra = {}) {
  return {
    kind,
    signature,
    recommendation: clean(recommendation),
    tsIso: clean(entry?.tsIso),
    tool: clean(entry?.tool),
    action: clean(entry?.action),
    errorType: clean(entry?.errorType),
    errorMessage: clean(entry?.errorMessage),
    ...extra,
  };
}

export function classifyToolcallFriction(entry) {
  if (!entry || typeof entry !== "object") return null;
  const startup = entry?.context?.startup && typeof entry.context.startup === "object" ? entry.context.startup : {};
  const retryGovernor = extractRetryGovernor(entry);
  const commandShape = extractCommandShape(entry);
  const startupArtifactRepair = extractStartupArtifactRepair(entry);
  const degradationBuckets = Array.isArray(startup.degradationBuckets) ? startup.degradationBuckets.map(clean) : [];
  const missingIngredients = Array.isArray(startup.missingStartupIngredients)
    ? startup.missingStartupIngredients.map(clean)
    : [];
  const errorText = [
    clean(entry?.errorType),
    clean(entry?.errorMessage),
    clean(startup.reasonCode),
    clean(startup.continuityState),
    degradationBuckets.join(" "),
    missingIngredients.join(" "),
  ]
    .join("\n")
    .toLowerCase();

  if (commandShape?.findingIds?.length) {
    return buildFrictionResult(
      "command-shape",
      `command-shape:${commandShape.findingIds.join("+")}`,
      clean(commandShape.recommendation) || "Use the recommended Windows-safe pattern before retrying this command.",
      entry,
      {
        findingIds: commandShape.findingIds,
        command: clean(commandShape.command),
        taskClass: clean(commandShape.taskClass),
      }
    );
  }

  if (startupArtifactRepair?.repaired) {
    return buildFrictionResult(
      "startup/artifact sync gap",
      `startup-artifact-repair:${startupArtifactRepair.source || startupArtifactRepair.reason || "unknown"}`,
      "Patch the checkpoint/handoff emitter so startup does not need to reconstruct missing local runtime artifacts from remote rows.",
      entry,
      {
        repairSource: startupArtifactRepair.source,
        repairReason: startupArtifactRepair.reason,
        repairCapturedFrom: startupArtifactRepair.capturedFrom,
      }
    );
  }

  if (STARTUP_AUTH_REASON_CODES.has(clean(startup.reasonCode)) || /startup_auth_stale/.test(errorText)) {
    return buildFrictionResult(
      "startup/auth",
      `startup-auth:${clean(startup.reasonCode) || clean(entry?.errorType) || "unknown"}`,
      "Refresh Studio Brain auth/transport health before retrying startup.",
      entry
    );
  }

  if (clean(startup.continuityState) && clean(startup.continuityState) !== "ready") {
    return buildFrictionResult(
      "startup/context quality",
      `startup-context:${clean(startup.continuityState) || "missing"}:${degradationBuckets.join("+") || "none"}`,
      "Improve startup-ready handoff/checkpoint memory so continuity stops degrading into fallback-only context.",
      entry,
      {
        degradationBuckets,
        missingIngredients,
      }
    );
  }

  if (PATH_FAILURE_PATTERNS.some((pattern) => pattern.test(errorText))) {
    return buildFrictionResult(
      "path/glob/ENOENT",
      `path-failure:${clean(entry?.errorType) || "unknown"}`,
      "Fix the path or glob shape before retrying; identical ENOENT-style retries rarely self-heal.",
      entry
    );
  }

  if (OUTPUT_BLOAT_PATTERNS.some((pattern) => pattern.test(errorText))) {
    return buildFrictionResult(
      "output explosion/context bloat",
      `output-bloat:${clean(entry?.errorType) || "unknown"}`,
      "Trim command output or split the task before retrying so the harness does not burn context on oversized responses.",
      entry
    );
  }

  if (EMPTY_OUTPUT_PATTERNS.some((pattern) => pattern.test(errorText))) {
    return buildFrictionResult(
      "output explosion/context bloat",
      `empty-output:${clean(entry?.errorType) || "unknown"}`,
      "Investigate why the command returned no usable output instead of repeating the same attempt.",
      entry
    );
  }

  if (retryGovernor?.triggered) {
    return buildFrictionResult(
      "blind retry bursts",
      `retry-burst:${clean(retryGovernor.signature)}`,
      "Pause the retry burst, change strategy, and only rerun once the failure mode is understood.",
      entry,
      {
        retrySignature: retryGovernor.signature,
      }
    );
  }

  return null;
}

export function buildOperatorDragMetrics(entries = []) {
  const frictionEntries = (entries || []).map((entry) => classifyToolcallFriction(entry)).filter(Boolean);
  const retryGovernorSignals = summarizeRetryGovernorSignals(entries);
  const commandShapeEntries = frictionEntries.filter((entry) => entry.kind === "command-shape");
  const outputBloatEntries = frictionEntries.filter((entry) => entry.kind === "output explosion/context bloat");
  const emptyOutputRetryCount = (entries || []).filter((entry) => {
    const governor = extractRetryGovernor(entry);
    const errorText = `${clean(entry?.errorType)}\n${clean(entry?.errorMessage)}`.toLowerCase();
    return governor && EMPTY_OUTPUT_PATTERNS.some((pattern) => pattern.test(errorText));
  }).length;
  const startupCoverage = summarizeStartupObservationCoverage(entries);
  const startupArtifactRepairEntries = startupCoverage.uniqueLiveEntries.filter(
    (entry) => extractStartupArtifactRepair(entry)?.repaired === true
  ).length;

  return {
    repeatedCommandShapeFailures: commandShapeEntries.length,
    commandShapeGuardTriggeredEntries: (entries || []).filter((entry) => extractCommandShape(entry)?.triggered === true).length,
    retriesPreventedByGovernor: retryGovernorSignals.triggeredEntries,
    startupArtifactRepairEntries,
    rawStartupEntries: startupCoverage.rawStartupEntries,
    syntheticRawRows: startupCoverage.syntheticRawRows,
    liveRawRows: startupCoverage.liveRawRows,
    syntheticStartupEntries: startupCoverage.syntheticUniqueObservations,
    liveStartupEntries: startupCoverage.liveUniqueObservations,
    syntheticUniqueObservations: startupCoverage.syntheticUniqueObservations,
    liveUniqueObservations: startupCoverage.liveUniqueObservations,
    syntheticDuplicateObservationCount: startupCoverage.syntheticDuplicateObservationCount,
    liveDuplicateObservationCount: startupCoverage.liveDuplicateObservationCount,
    duplicateObservationCount: startupCoverage.duplicateObservationCount,
    syntheticVsLiveStartupRatio:
      startupCoverage.liveUniqueObservations > 0
        ? Number((startupCoverage.syntheticUniqueObservations / startupCoverage.liveUniqueObservations).toFixed(3))
        : null,
    oversizedOutputIncidents: outputBloatEntries.length,
    emptyOutputRetryCount,
  };
}

export function summarizeToolcallDrag(entries = [], { limit = 3 } = {}) {
  const grouped = new Map();
  for (const entry of entries || []) {
    const friction = classifyToolcallFriction(entry);
    if (!friction) continue;
    if (!grouped.has(friction.signature)) {
      grouped.set(friction.signature, {
        kind: friction.kind,
        signature: friction.signature,
        count: 0,
        recommendation: friction.recommendation,
        lastSeenIso: friction.tsIso,
        sampleError: friction.errorMessage || friction.errorType || "",
      });
    }
    const item = grouped.get(friction.signature);
    item.count += 1;
    item.recommendation = item.recommendation || friction.recommendation;
    if ((toMs(friction.tsIso) ?? 0) > (toMs(item.lastSeenIso) ?? 0)) {
      item.lastSeenIso = friction.tsIso;
      item.sampleError = friction.errorMessage || friction.errorType || item.sampleError;
    }
  }

  return Array.from(grouped.values())
    .sort(
      (left, right) =>
        right.count - left.count ||
        (toMs(right.lastSeenIso) ?? 0) - (toMs(left.lastSeenIso) ?? 0) ||
        String(left.signature).localeCompare(String(right.signature))
    )
    .slice(0, Math.max(1, Math.round(Number(limit) || 3)));
}
