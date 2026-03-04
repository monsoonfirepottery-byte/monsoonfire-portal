function toMs(value) {
  if (!value) return 0;
  const parsed = new Date(String(value));
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeLabel(value) {
  return String(value || "").trim();
}

function clipSnippet(value, maxChars = 220) {
  const text = normalizeLabel(value).replace(/\s+/g, " ");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function parseDelimitedList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLabel(item)).filter(Boolean);
  }
  const raw = normalizeLabel(value);
  if (!raw) return [];
  return raw
    .split(/[;,]/g)
    .map((item) => normalizeLabel(item))
    .filter(Boolean);
}

function collectTopCounts(map, limit = 5, fieldName = "value") {
  return Array.from(map.entries())
    .sort((left, right) => {
      const countDelta = Number(right[1] || 0) - Number(left[1] || 0);
      if (countDelta !== 0) return countDelta;
      return String(left[0]).localeCompare(String(right[0]));
    })
    .slice(0, Math.max(0, limit))
    .map(([value, count]) => ({ [fieldName]: value, count: Number(count || 0) }));
}

function collectIdentityCandidates(metadata) {
  const direct = [
    metadata.senderName,
    metadata.senderAddress,
    metadata.fromName,
    metadata.fromAddress,
    metadata.contact,
    metadata.sender,
    metadata.from,
  ];
  const grouped = [
    ...parseDelimitedList(metadata.to),
    ...parseDelimitedList(metadata.recipients),
    ...parseDelimitedList(metadata.participants),
  ];
  return [...direct, ...grouped]
    .map((value) => normalizeLabel(value))
    .filter(Boolean);
}

function collectWorkstreamCandidates(metadata) {
  const direct = [
    metadata.threadKey,
    metadata.subject,
    metadata.topic,
    metadata.mailboxPath,
    metadata.mailboxName,
  ];
  const grouped = [...parseDelimitedList(metadata.themes), ...parseDelimitedList(metadata.tags)];
  return [...direct, ...grouped]
    .map((value) => normalizeLabel(value))
    .filter(Boolean);
}

export function buildRelationshipQualityArtifact({ runId, promotedRows, generatedAt }) {
  const edgeCountByType = new Map();
  let orphanRows = 0;
  let linkedRows = 0;
  let unresolvedConflictEdges = 0;

  for (const row of promotedRows) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    const relatedMemoryIds = Array.isArray(metadata.relatedMemoryIds) ? metadata.relatedMemoryIds : [];
    const relationTypes = Array.isArray(metadata.relationTypes)
      ? metadata.relationTypes.map((item) => normalizeLabel(item)).filter(Boolean)
      : [];

    if (relatedMemoryIds.length === 0) {
      orphanRows += 1;
    } else {
      linkedRows += 1;
      if (relationTypes.length === 0) {
        edgeCountByType.set(
          "relatedMemoryIds",
          Number(edgeCountByType.get("relatedMemoryIds") || 0) + relatedMemoryIds.length
        );
      } else {
        for (const relationType of relationTypes) {
          edgeCountByType.set(
            relationType,
            Number(edgeCountByType.get(relationType) || 0) + relatedMemoryIds.length
          );
        }
      }
    }

    if (Array.isArray(metadata.conflictMemoryIds)) {
      unresolvedConflictEdges += metadata.conflictMemoryIds.length;
    } else if (Array.isArray(metadata.conflictEdges)) {
      unresolvedConflictEdges += metadata.conflictEdges.length;
    } else if (metadata.hasConflict === true || metadata.semanticConflict === true) {
      unresolvedConflictEdges += 1;
    }
  }

  const orphanToLinkedRatio =
    linkedRows > 0 ? Number((orphanRows / linkedRows).toFixed(3)) : (orphanRows > 0 ? null : 0);
  const totalEdges = Array.from(edgeCountByType.values()).reduce(
    (sum, value) => sum + Number(value || 0),
    0
  );

  return {
    schema: "pst-memory-relationship-quality.v1",
    generatedAt,
    runId,
    edgeCountByType: Object.fromEntries(edgeCountByType.entries()),
    orphanToLinkedRatio,
    unresolvedConflictEdges,
    counts: {
      promotedRows: promotedRows.length,
      linkedRows,
      orphanRows,
      totalEdges,
    },
  };
}

export function buildContinuityArtifact({
  runId,
  promotedRows,
  generatedAt,
  handoffOwner,
  handoffSourceShellId,
  handoffTargetShellId,
  resumeHints,
}) {
  const sortedRows = promotedRows
    .slice()
    .sort((left, right) => {
      const leftMs = Math.max(
        toMs(left?.occurredAt),
        toMs(left?.metadata?.sourceSentAt),
        toMs(left?.metadata?.sourceReceivedAt)
      );
      const rightMs = Math.max(
        toMs(right?.occurredAt),
        toMs(right?.metadata?.sourceSentAt),
        toMs(right?.metadata?.sourceReceivedAt)
      );
      return rightMs - leftMs;
    });

  const identityCounts = new Map();
  const workstreamCounts = new Map();
  for (const row of promotedRows) {
    const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
    for (const candidate of collectIdentityCandidates(metadata)) {
      identityCounts.set(candidate, Number(identityCounts.get(candidate) || 0) + 1);
    }
    for (const candidate of collectWorkstreamCandidates(metadata)) {
      workstreamCounts.set(candidate, Number(workstreamCounts.get(candidate) || 0) + 1);
    }
  }

  const lastDecisionCommitment =
    sortedRows.find((row) => {
      const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
      const analysisType = normalizeLabel(metadata.analysisType).toLowerCase();
      if (analysisType.includes("decision") || analysisType.includes("commit")) return true;
      return /\b(decid(ed|e|ing)?|commit(ment|ted|ting)?|we will|next step|action item)\b/i.test(
        String(row?.content || "")
      );
    }) || null;

  const derivedResumeHints = resumeHints.length
    ? resumeHints
    : collectTopCounts(workstreamCounts, 3, "workstream").map((item) => item.workstream);

  return {
    schema: "pst-memory-continuity.v1",
    generatedAt,
    runId,
    identityAnchors: collectTopCounts(identityCounts, 5, "identity"),
    activeWorkstreams: collectTopCounts(workstreamCounts, 5, "workstream"),
    lastDecisionCommitment: lastDecisionCommitment
      ? {
          id: normalizeLabel(lastDecisionCommitment.id),
          occurredAt:
            normalizeLabel(lastDecisionCommitment.occurredAt) ||
            normalizeLabel(lastDecisionCommitment?.metadata?.sourceSentAt) ||
            null,
          summary: clipSnippet(lastDecisionCommitment.content, 240),
          analysisType: normalizeLabel(lastDecisionCommitment?.metadata?.analysisType) || null,
        }
      : null,
    recentIntentTrajectory: sortedRows.slice(0, 6).map((row) => ({
      id: normalizeLabel(row.id),
      occurredAt:
        normalizeLabel(row.occurredAt) ||
        normalizeLabel(row?.metadata?.sourceSentAt) ||
        normalizeLabel(row?.metadata?.sourceReceivedAt) ||
        null,
      analysisType: normalizeLabel(row?.metadata?.analysisType) || null,
      summary: clipSnippet(row.content, 180),
    })),
    activeHandoff: {
      handoffOwner: normalizeLabel(handoffOwner) || null,
      handoffSourceShellId: normalizeLabel(handoffSourceShellId) || null,
      handoffTargetShellId: normalizeLabel(handoffTargetShellId) || null,
      resumeHints: derivedResumeHints,
    },
    counts: {
      promotedRows: promotedRows.length,
      rowsWithRelations: promotedRows.filter((row) =>
        Array.isArray(row?.metadata?.relatedMemoryIds) && row.metadata.relatedMemoryIds.length > 0
      ).length,
    },
  };
}

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function evaluateThreshold(value, warn, critical) {
  if (value >= critical) return "critical";
  if (value >= warn) return "warn";
  return "ok";
}

function summarizeAlertCounts(alerts) {
  const counts = {
    ok: 0,
    warn: 0,
    critical: 0,
  };
  for (const alert of alerts) {
    const status = String(alert?.status || "ok");
    if (status === "critical") {
      counts.critical += 1;
      continue;
    }
    if (status === "warn") {
      counts.warn += 1;
      continue;
    }
    counts.ok += 1;
  }
  return counts;
}

export function buildRelationshipMonitoringArtifact({
  runId,
  generatedAt,
  relationshipQualityArtifact,
  continuityArtifact,
  thresholds = {},
}) {
  const quality = relationshipQualityArtifact && typeof relationshipQualityArtifact === "object"
    ? relationshipQualityArtifact
    : {};
  const continuity = continuityArtifact && typeof continuityArtifact === "object"
    ? continuityArtifact
    : {};
  const counts = quality.counts && typeof quality.counts === "object" ? quality.counts : {};
  const handoff = continuity.activeHandoff && typeof continuity.activeHandoff === "object"
    ? continuity.activeHandoff
    : {};
  const resumeHints = Array.isArray(handoff.resumeHints) ? handoff.resumeHints : [];
  const recentIntentTrajectory = Array.isArray(continuity.recentIntentTrajectory)
    ? continuity.recentIntentTrajectory
    : [];

  const nowMs = toMs(generatedAt);
  const mostRecentIntentMs = recentIntentTrajectory.reduce(
    (latest, row) => Math.max(latest, toMs(row?.occurredAt)),
    0
  );
  const recentIntentAgeHours =
    mostRecentIntentMs > 0 && nowMs > 0
      ? Number(((nowMs - mostRecentIntentMs) / (1000 * 60 * 60)).toFixed(2))
      : null;

  const metrics = {
    orphanToLinkedRatio:
      typeof quality.orphanToLinkedRatio === "number" ? quality.orphanToLinkedRatio : null,
    unresolvedConflictEdges: toFiniteNumber(quality.unresolvedConflictEdges, 0),
    failedEdgeResolutionCount: toFiniteNumber(
      quality.failedEdgeResolutionCount ??
        quality.failedEdgeResolutions ??
        quality.edgeResolutionFailures ??
        counts.failedEdgeResolutionCount,
      0
    ),
    inverseEdgeMismatchCount: toFiniteNumber(
      quality.inverseEdgeMismatchCount ?? quality.inverseMismatches ?? counts.inverseEdgeMismatchCount,
      0
    ),
    staleRelationshipCount: toFiniteNumber(
      quality.staleRelationshipCount ?? quality.staleRelationships ?? counts.staleRelationshipCount,
      0
    ),
    recentIntentAgeHours,
    openLoopHandoffCount: toFiniteNumber(
      quality.openLoopHandoffCount ??
        continuity.openLoopHandoffCount ??
        resumeHints.length +
          (normalizeLabel(handoff.handoffOwner) ||
          normalizeLabel(handoff.handoffSourceShellId) ||
          normalizeLabel(handoff.handoffTargetShellId)
            ? 1
            : 0),
      0
    ),
    edgeCountByType:
      quality.edgeCountByType && typeof quality.edgeCountByType === "object"
        ? quality.edgeCountByType
        : {},
    promotedRows: toFiniteNumber(counts.promotedRows, 0),
    linkedRows: toFiniteNumber(counts.linkedRows, 0),
    orphanRows: toFiniteNumber(counts.orphanRows, 0),
    totalEdges: toFiniteNumber(counts.totalEdges, 0),
  };

  const staleWarnHours = Math.max(1, toFiniteNumber(thresholds.staleIntentWarnHours, 72));
  const staleCriticalHours = Math.max(staleWarnHours, toFiniteNumber(thresholds.staleIntentCriticalHours, 168));

  const orphanRatioWarn = Math.max(0, toFiniteNumber(thresholds.orphanRatioWarn, 1));
  const orphanRatioCritical = Math.max(orphanRatioWarn, toFiniteNumber(thresholds.orphanRatioCritical, 2));
  const conflictWarn = Math.max(0, toFiniteNumber(thresholds.unresolvedConflictWarn, 1));
  const conflictCritical = Math.max(conflictWarn, toFiniteNumber(thresholds.unresolvedConflictCritical, 8));
  const failedEdgeWarn = Math.max(0, toFiniteNumber(thresholds.failedEdgeResolutionWarn, 1));
  const failedEdgeCritical = Math.max(failedEdgeWarn, toFiniteNumber(thresholds.failedEdgeResolutionCritical, 5));
  const inverseWarn = Math.max(0, toFiniteNumber(thresholds.inverseEdgeMismatchWarn, 1));
  const inverseCritical = Math.max(inverseWarn, toFiniteNumber(thresholds.inverseEdgeMismatchCritical, 5));
  const openLoopWarn = Math.max(0, toFiniteNumber(thresholds.openLoopHandoffWarn, 2));
  const openLoopCritical = Math.max(openLoopWarn, toFiniteNumber(thresholds.openLoopHandoffCritical, 6));

  const orphanStatus =
    typeof metrics.orphanToLinkedRatio === "number"
      ? evaluateThreshold(metrics.orphanToLinkedRatio, orphanRatioWarn, orphanRatioCritical)
      : metrics.orphanRows > 0
        ? "warn"
        : "ok";
  const staleStatus =
    typeof metrics.recentIntentAgeHours === "number"
      ? evaluateThreshold(metrics.recentIntentAgeHours, staleWarnHours, staleCriticalHours)
      : "warn";

  const alerts = [
    {
      id: "orphan-rate",
      status: orphanStatus,
      value: metrics.orphanToLinkedRatio,
      warnThreshold: orphanRatioWarn,
      criticalThreshold: orphanRatioCritical,
      detail: "orphan-to-linked ratio from relationship-quality artifact",
    },
    {
      id: "stale-relationships",
      status: staleStatus,
      value: metrics.recentIntentAgeHours,
      warnThreshold: staleWarnHours,
      criticalThreshold: staleCriticalHours,
      detail: "age (hours) of most recent continuity intent entry",
    },
    {
      id: "failed-edge-resolution",
      status: evaluateThreshold(metrics.failedEdgeResolutionCount, failedEdgeWarn, failedEdgeCritical),
      value: metrics.failedEdgeResolutionCount,
      warnThreshold: failedEdgeWarn,
      criticalThreshold: failedEdgeCritical,
      detail: "failed relationship edge resolutions",
    },
    {
      id: "inverse-edge-mismatch",
      status: evaluateThreshold(metrics.inverseEdgeMismatchCount, inverseWarn, inverseCritical),
      value: metrics.inverseEdgeMismatchCount,
      warnThreshold: inverseWarn,
      criticalThreshold: inverseCritical,
      detail: "inverse relationship mismatch count",
    },
    {
      id: "open-loop-handoff",
      status: evaluateThreshold(metrics.openLoopHandoffCount, openLoopWarn, openLoopCritical),
      value: metrics.openLoopHandoffCount,
      warnThreshold: openLoopWarn,
      criticalThreshold: openLoopCritical,
      detail: "active handoff + resume-hint loop count",
    },
    {
      id: "unresolved-conflict-edges",
      status: evaluateThreshold(metrics.unresolvedConflictEdges, conflictWarn, conflictCritical),
      value: metrics.unresolvedConflictEdges,
      warnThreshold: conflictWarn,
      criticalThreshold: conflictCritical,
      detail: "unresolved conflict relationship edges",
    },
  ];

  const alertCounts = summarizeAlertCounts(alerts);
  const overallStatus = alertCounts.critical > 0 ? "critical" : alertCounts.warn > 0 ? "warn" : "ok";

  return {
    schema: "pst-memory-relationship-monitor.v1",
    generatedAt,
    runId,
    status: overallStatus,
    metrics,
    alerts,
    summary: {
      alertCounts,
      healthy: overallStatus === "ok",
    },
  };
}
