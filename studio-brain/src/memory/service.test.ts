import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createMemoryService } from "./service";
import { createInMemoryMemoryStoreAdapter } from "./inMemoryAdapter";

const memoryConsolidationArtifactPath = () =>
  resolve(__dirname, "..", "..", "..", "output", "studio-brain", "memory-consolidation", "latest.json");

test("memory service capture/search pipeline works with in-memory adapter", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-a",
  });

  const first = await service.capture({
    content: "Decision: launch moved after QA blocker review.",
    source: "manual",
    clientRequestId: "capture-1",
  });
  assert.equal(first.tenantId, "tenant-a");
  assert.ok(first.id.startsWith("mem_req_"));

  const duplicate = await service.capture({
    content: "Decision: launch moved after QA blocker review.",
    source: "manual",
    clientRequestId: "capture-1",
  });
  assert.equal(duplicate.id, first.id);

  const rows = await service.search({ query: "QA blocker" });
  assert.ok(rows.length >= 1);
  assert.equal(rows[0]?.id, first.id);

  const stats = await service.stats({});
  assert.equal(stats.total, 1);
  assert.equal(stats.bySource[0]?.source, "manual");
});

test("memory service derives episodic accepted decisions and working-memory TTLs", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-layer-routing",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-layer-routing",
  });

  const decision = await service.capture({
    content: "Decision: keep the operator board browser-first until the new dashboard stabilizes.",
    source: "manual",
    tags: ["decision"],
  });
  const scratch = await service.capture({
    content: "Channel scratch note for the active Discord thread.",
    source: "thread-scratch",
    metadata: {
      channelId: "discord-channel-1",
    },
  });

  assert.equal(decision.memoryLayer, "episodic");
  assert.equal(decision.status, "accepted");
  assert.equal(decision.lattice?.category, "decision");
  assert.equal(decision.lattice?.truthStatus, "verified");
  assert.equal(decision.lattice?.freshnessStatus, "fresh");
  assert.equal(decision.lattice?.operationalStatus, "active");
  assert.equal(scratch.memoryLayer, "working");
  assert.equal(typeof (scratch.metadata as Record<string, unknown>).expiresAt, "string");
  assert.equal(scratch.lattice?.category, "observation");
});

test("memory service defaults Codex trace hints into accepted episodic memory", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-codex-traces",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-codex-traces",
  });

  const trace = await service.capture({
    content: "Thought: capture the action trail so dream cleanup can sort it later.",
    source: "codex",
    tags: ["codex-trace", "codex-trace:thought"],
    metadata: {
      memoryKind: "thought",
      rememberKind: "thought",
      codexTraceKind: "thought",
    },
  });

  assert.equal(trace.memoryLayer, "episodic");
  assert.equal(trace.status, "accepted");
  assert.equal((trace.metadata as Record<string, unknown>).memoryLayer, "episodic");
});

test("memory service search and stats honor layer filters", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-layer-filters",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    content: "Working scratch for the current operator lane.",
    source: "thread-scratch",
    metadata: { channelId: "ops-room" },
  });
  await service.capture({
    content: "Canonical note backed by repo markdown lineage.",
    source: "repo-markdown",
    metadata: {
      corpusRecordId: "repo-record-1",
      sourceArtifactPath: "docs/operator.md",
    },
  });

  const workingOnly = await service.search({
    query: "operator lane canonical note",
    layerAllowlist: ["working"],
  });
  const stats = await service.stats({
    layerDenylist: ["working"],
  });

  assert.equal(workingOnly.length, 1);
  assert.equal(workingOnly[0]?.memoryLayer, "working");
  assert.equal(stats.byLayer.some((entry) => entry.layer === "canonical"), true);
  assert.equal(stats.byLayer.some((entry) => entry.layer === "working"), false);
});

test("memory service safety-critical search filters stale and speculative memories", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-memory-lattice",
    defaultAgentId: "agent:codex",
  });

  const freshFact = await service.capture({
    content: "Portal contract fact: startup continuity requires trusted repo-backed evidence before high-impact actions.",
    source: "repo-markdown",
    clientRequestId: "fresh-fact",
    metadata: {
      sourceArtifactPath: "docs/runbooks/CODEX_RECOVERY.md",
      corpusRecordId: "repo-record-fresh",
    },
  });
  const staleFact = await service.capture({
    content: "Portal contract fact: startup continuity requires trusted repo-backed evidence before high-impact actions.",
    source: "repo-markdown",
    clientRequestId: "stale-fact",
    occurredAt: "2025-01-10T00:00:00.000Z",
    lastVerifiedAt: "2025-01-10T00:00:00.000Z",
    metadata: {
      sourceArtifactPath: "docs/legacy/startup-memory.md",
      corpusRecordId: "repo-record-stale",
    },
  });
  const hypothesis = await service.capture({
    content: "Hypothesis: maybe startup continuity trusted evidence still fails because of a hidden cache race.",
    source: "manual",
    memoryCategory: "hypothesis",
  });

  const rows = await service.search({
    query: "startup continuity trusted repo-backed evidence",
    useMode: "safety-critical",
    layerAllowlist: ["canonical", "episodic"],
  });

  assert.equal(rows.some((row) => row.id === freshFact.id), true);
  assert.equal(rows.some((row) => row.id === staleFact.id), false);
  assert.equal(rows.some((row) => row.id === hypothesis.id), false);
  assert.equal(rows.every((row) => row.lattice?.freshnessStatus === "fresh"), true);
  assert.equal(rows.every((row) => row.lattice?.truthStatus === "verified" || row.lattice?.truthStatus === "trusted"), true);
});

test("memory service fills to a valid limit when strict retrieval filters would otherwise starve the result window", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-valid-fill",
    defaultAgentId: "agent:codex",
  });

  for (let index = 0; index < 8; index += 1) {
    await service.capture({
      content: `Hypothesis ${index}: startup continuity trusted evidence might just be cache noise.`,
      source: "manual",
      memoryCategory: "hypothesis",
      clientRequestId: `fill-invalid-${index}`,
    });
  }

  const trusted = await service.capture({
    content: "Fact: startup continuity trusted evidence must come from repo-backed provenance.",
    source: "repo-markdown",
    clientRequestId: "fill-valid-fact",
    metadata: {
      sourceArtifactPath: "docs/runbooks/CODEX_RECOVERY.md",
      corpusRecordId: "repo-record-fill-valid",
    },
  });

  const rows = await service.search({
    query: "startup continuity trusted evidence provenance",
    useMode: "safety-critical",
    fillToValidLimit: true,
    evidenceRequired: true,
    minAuthorityClass: "a1-repo",
    limit: 1,
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.id, trusted.id);
  assert.equal(rows[0]?.lattice?.hasEvidence, true);
});

test("memory lattice derives review actions and stats backlog", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-memory-review",
    defaultAgentId: "agent:codex",
  });

  const trusted = await service.capture({
    content: "Portal fact: repo-backed startup guardrails are the current source of truth for risky edits.",
    source: "repo-markdown",
    clientRequestId: "review-fact-trusted",
    metadata: {
      corpusRecordId: "repo-record-review-trusted",
      sourceArtifactPath: "docs/runbooks/startup-guardrails.md",
    },
  });
  const staleFact = await service.capture({
    content: "Portal fact: repo-backed startup guardrails are the current source of truth for risky edits.",
    source: "repo-markdown",
    clientRequestId: "review-fact-stale",
    occurredAt: "2025-01-10T00:00:00.000Z",
    lastVerifiedAt: "2025-01-10T00:00:00.000Z",
    metadata: {
      corpusRecordId: "repo-record-review-stale",
      sourceArtifactPath: "docs/archive/startup-guardrails-stale.md",
    },
  });
  const staleHypothesis = await service.capture({
    content: "Hypothesis: maybe the startup continuity cache still leaks obsolete guardrails across runs.",
    source: "manual",
    clientRequestId: "review-hypothesis-stale",
    occurredAt: "2025-01-10T00:00:00.000Z",
    memoryCategory: "hypothesis",
  });
  const contradictedGuardrail = await service.capture({
    content: "Guardrail: never trust contested startup memory without repo verification.",
    source: "manual",
    clientRequestId: "review-guardrail-conflict",
    tags: ["guardrail"],
    metadata: {
      subjectKey: "startup-memory-guardrail",
      contradictions: ["Current repo evidence conflicts with the inherited instruction."],
    },
  });

  const rows = await service.recent({
    limit: 10,
    useMode: "debugging",
  });
  const byId = new Map(rows.map((row) => [row.id, row] as const));
  const stats = await service.stats({});

  assert.equal(byId.get(trusted.id)?.lattice?.reviewAction, "none");
  assert.equal(byId.get(staleFact.id)?.lattice?.reviewAction, "revalidate");
  assert.equal(byId.get(staleHypothesis.id)?.lattice?.reviewAction, "retire");
  assert.equal(byId.get(contradictedGuardrail.id)?.lattice?.reviewAction, "resolve-conflict");
  assert.equal(byId.get(contradictedGuardrail.id)?.lattice?.reviewReasons.includes("contradicted"), true);

  assert.equal(stats.lattice?.coverage.rowsWithLattice, 4);
  assert.equal(stats.lattice?.coverage.totalRows, 4);
  assert.equal(stats.lattice?.coverage.ratio, 1);
  assert.equal(stats.lattice?.backlog.reviewNow, 3);
  assert.equal(stats.lattice?.backlog.revalidate, 1);
  assert.equal(stats.lattice?.backlog.resolveConflict, 1);
  assert.equal(stats.lattice?.backlog.retire, 1);
  assert.equal(stats.lattice?.byReviewAction.some((entry) => entry.action === "resolve-conflict" && entry.count === 1), true);
});

test("memory capture redacts secret-bearing content, quarantines it, and emits a transition event", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-secret-hygiene",
    defaultAgentId: "agent:codex",
  });

  const captured = await service.capture({
    content:
      "Operator note: Authorization: Bearer test-redaction-token",
    source: "manual",
    clientRequestId: "secret-capture-1",
  });

  assert.equal(captured.status, "quarantined");
  assert.equal(captured.content.includes("[redacted-token]"), true);
  assert.equal((captured.metadata as Record<string, unknown>).redactionState, "redacted");
  assert.equal(((captured.metadata as Record<string, unknown>).secretExposure as Record<string, unknown>).detected, true);
  assert.equal(captured.lattice?.secretExposure, true);
  assert.equal(captured.transitions?.length, 1);
  assert.equal(captured.transitions?.[0]?.toStatus, "quarantined");
});

test("memory search can require evidence and a minimum authority floor", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-evidence-policy",
    defaultAgentId: "agent:codex",
  });

  const repoFact = await service.capture({
    content: "Fact: launch trust depends on evidence-backed repo memory for startup continuity.",
    source: "repo-markdown",
    clientRequestId: "evidence-policy-repo",
    metadata: {
      sourceArtifactPath: "docs/runbooks/CODEX_RECOVERY.md",
      corpusRecordId: "repo-record-evidence-policy",
    },
  });
  await service.capture({
    content: "Decision: launch trust depends on evidence-backed repo memory for startup continuity.",
    source: "manual",
    clientRequestId: "evidence-policy-manual",
  });

  const rows = await service.search({
    query: "launch trust evidence-backed repo memory startup continuity",
    evidenceRequired: true,
    minAuthorityClass: "a1-repo",
    limit: 5,
  });

  assert.equal(rows.some((row) => row.id === repoFact.id), true);
  assert.equal(rows.every((row) => row.lattice?.hasEvidence === true), true);
  assert.equal(rows.every((row) => row.lattice?.authorityClass === "a0-live" || row.lattice?.authorityClass === "a1-repo"), true);
});

test("memory stats surface startup, secret, and shadow MCP launch findings", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-launch-findings",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    content: "Handoff: verify startup continuity before launch.",
    source: "codex-handoff",
    clientRequestId: "launch-handoff",
    metadata: {
      rememberKind: "handoff",
      startupEligible: true,
      threadId: "thread-launch-findings",
      threadEvidence: "explicit",
    },
  });
  await service.capture({
    content:
      "Operator note: Authorization: Bearer launch-redaction-token",
    source: "manual",
    clientRequestId: "launch-secret",
  });
  await service.capture({
    content: "Connector result: MCP surfaced a repo sync status from an unapproved server.",
    source: "mcp-tool:repo-sync",
    clientRequestId: "launch-shadow-mcp",
    metadata: {
      mcpGovernance: {
        approvalState: "pending",
        shadowRisk: true,
      },
    },
  });

  const stats = await service.stats({});
  assert.equal((stats.startupReadiness?.startupEligibleRows ?? 0) >= 1, true);
  assert.equal((stats.startupReadiness?.handoffRows ?? 0) >= 1, true);
  assert.equal((stats.secretExposureFindings?.canonicalBlockedRows ?? 0) >= 1, true);
  assert.equal((stats.shadowMcpFindings?.highRiskRows ?? 0) >= 1, true);
});

test("memory capture quarantines exact conflicting loop states and emits a conflict record", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-memory-conflicts",
    defaultAgentId: "agent:codex",
  });

  const resolved = await service.capture({
    content: "Decision: startup continuity auth drift is resolved and the operator path is stable again.",
    source: "manual",
    tags: ["decision"],
    metadata: {
      subjectKey: "startup-continuity-auth-drift",
      loopState: "resolved",
    },
  });
  const conflicting = await service.capture({
    content: "Decision: startup continuity auth drift still blocks the operator path right now.",
    source: "manual",
    tags: ["decision"],
    metadata: {
      subjectKey: "startup-continuity-auth-drift",
      loopState: "open-loop",
    },
  });

  assert.equal(conflicting.lattice?.truthStatus, "contradicted");
  assert.equal(conflicting.lattice?.operationalStatus, "quarantined");
  assert.equal(conflicting.lattice?.reviewAction, "resolve-conflict");
  assert.equal(conflicting.lattice?.conflictSeverity, "hard");
  assert.equal(conflicting.lattice?.conflictKinds.includes("exact-loop-state"), true);
  assert.equal(conflicting.lattice?.conflictingMemoryIds.includes(resolved.id), true);

  const debugRows = await service.recent({
    limit: 20,
    useMode: "debugging",
  });
  const conflictRecord = debugRows.find(
    (row) => row.source === "memory-contradiction-watch" && row.lattice?.category === "conflict-record",
  );

  assert.ok(conflictRecord);
  assert.equal(conflictRecord?.lattice?.truthStatus, "verified");
  assert.equal(conflictRecord?.lattice?.operationalStatus, "active");
  assert.equal(
    Array.isArray((conflictRecord?.metadata as Record<string, unknown> | undefined)?.conflictingMemoryIds),
    true,
  );
  assert.equal(
    ((conflictRecord?.metadata as Record<string, unknown> | undefined)?.conflictingMemoryIds as string[]).includes(conflicting.id),
    true,
  );

  const operationalRows = await service.search({
    query: "startup continuity auth drift",
    useMode: "operational",
  });
  const planningRows = await service.search({
    query: "startup continuity auth drift conflict",
    useMode: "planning",
  });
  const planningContext = await service.context({
    query: "startup continuity auth drift conflict",
    useMode: "planning",
    maxItems: 10,
    maxChars: 4000,
  });
  const operationalContext = await service.context({
    query: "startup continuity auth drift",
    useMode: "operational",
    maxItems: 10,
    maxChars: 4000,
  });
  const stats = await service.stats({});
  const planningById = new Map(planningRows.map((row) => [row.id, row] as const));

  assert.equal(operationalRows.some((row) => row.id === resolved.id), false);
  assert.equal(operationalRows.some((row) => row.id === conflicting.id), false);
  assert.equal(operationalRows.some((row) => row.id === conflictRecord?.id), false);
  assert.equal(operationalContext.items.some((row) => row.id === resolved.id), false);
  assert.equal(operationalContext.items.some((row) => row.id === conflicting.id), false);
  assert.equal(operationalContext.items.some((row) => row.id === conflictRecord?.id), false);
  assert.equal(operationalContext.summary.includes("Operational retrieval blocked by a hard conflict"), true);
  assert.equal(operationalContext.diagnostics.blockedByHardConflict?.blocked, true);
  assert.equal(operationalContext.diagnostics.blockedByHardConflict?.useMode, "operational");
  assert.equal(operationalContext.diagnostics.blockedByHardConflict?.scope, "subject:startup-continuity-auth-drift");
  assert.equal(
    operationalContext.diagnostics.blockedByHardConflict?.conflictRecordId === null
    || operationalContext.diagnostics.blockedByHardConflict?.conflictRecordId === conflictRecord?.id,
    true,
  );
  assert.equal(
    operationalContext.diagnostics.blockedByHardConflict?.conflictingMemoryIds.includes(resolved.id),
    true,
  );
  assert.equal(
    operationalContext.diagnostics.blockedByHardConflict?.conflictingMemoryIds.includes(conflicting.id),
    true,
  );
  assert.equal(planningRows.some((row) => row.id === resolved.id), true);
  assert.equal(planningRows.some((row) => row.id === conflicting.id), true);
  assert.equal(planningRows.some((row) => row.id === conflictRecord?.id), true);
  assert.equal(planningById.get(resolved.id)?.lattice?.truthStatus, "contradicted");
  assert.equal(planningById.get(resolved.id)?.lattice?.operationalStatus, "quarantined");
  assert.equal(planningById.get(resolved.id)?.lattice?.reviewAction, "resolve-conflict");
  assert.equal(planningById.get(resolved.id)?.matchedBy.includes("conflict-shadow"), true);
  assert.equal(planningContext.items.some((row) => row.id === resolved.id), true);
  assert.equal(planningContext.items.some((row) => row.id === conflicting.id), true);
  assert.equal(planningContext.items.some((row) => row.id === conflictRecord?.id), true);
  assert.equal(conflictRecord?.lattice?.conflictSeverity, "hard");
  assert.equal(conflictRecord?.lattice?.reviewAction, "none");
  assert.equal(stats.lattice?.backlog.resolveConflict, 1);
  assert.equal(stats.conflictBacklog?.contestedRows, 1);
  assert.equal(stats.conflictBacklog?.quarantinedRows, 1);
  assert.equal(stats.conflictBacklog?.retrievalShadowedRows, 2);
});

test("memory review cases open for hard conflicts and blocked diagnostics surface review guidance", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-memory-review-cases",
    defaultAgentId: "agent:codex",
  });

  const resolved = await service.capture({
    content: "Decision: startup continuity auth drift is resolved and the operator path is stable again.",
    source: "manual",
    tags: ["decision"],
    metadata: {
      subjectKey: "startup-continuity-auth-drift",
      loopState: "resolved",
    },
  });
  await service.capture({
    content: "Decision: startup continuity auth drift still blocks the operator path right now.",
    source: "manual",
    tags: ["decision"],
    metadata: {
      subjectKey: "startup-continuity-auth-drift",
      loopState: "open-loop",
    },
  });

  const context = await service.context({
    query: "startup continuity auth drift",
    useMode: "operational",
    maxItems: 8,
    maxChars: 3_000,
  });
  const reviewCases = await service.listReviewCases({
    statuses: ["open", "in-progress"],
    limit: 10,
  });
  const verificationRuns = await service.listVerificationRuns({
    caseId: reviewCases[0]?.id ?? null,
    limit: 10,
  });
  const stats = await service.stats({});

  assert.equal(context.diagnostics.blockedByHardConflict?.blocked, true);
  assert.equal(Boolean(context.diagnostics.blockedByHardConflict?.reviewCaseId), true);
  assert.equal(
    context.diagnostics.blockedByHardConflict?.recommendedActions?.includes("accept_winner"),
    true,
  );
  assert.equal(reviewCases.length >= 1, true);
  assert.equal(reviewCases[0]?.caseType, "resolve-conflict");
  assert.equal(reviewCases[0]?.linkedMemoryIds.includes(resolved.id), true);
  assert.equal(verificationRuns.length >= 1, true);
  assert.equal(verificationRuns[0]?.resultStatus === "failed" || verificationRuns[0]?.resultStatus === "needs-review", true);
  assert.equal((stats.openReviewCases ?? 0) >= 1, true);
  assert.equal((stats.verificationFailures24h ?? 0) >= 0, true);
});

test("memory review actions retire stale workaround memory and resolve the review case", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-memory-review-actions",
    defaultAgentId: "agent:codex",
  });

  const workaround = await service.capture({
    content: "Workaround: rely on the archived startup cache when repo verification is unavailable.",
    source: "manual",
    occurredAt: "2025-01-10T00:00:00.000Z",
    memoryCategory: "workaround",
  });
  const reviewCase = (await service.listReviewCases({
    statuses: ["open", "in-progress"],
    caseTypes: ["retire"],
    limit: 10,
  }))[0];

  assert.ok(reviewCase);

  const actionResult = await service.reviewCaseAction({
    id: reviewCase.id,
    action: "retire_memory",
    actorId: "staff-test",
    selectedMemoryId: workaround.id,
  });
  const updated = (await service.getByIds({
    ids: [workaround.id],
    includeArchived: true,
  }))[0];
  const latestCase = await service.getReviewCase({
    id: reviewCase.id,
  });
  const verificationRuns = await service.listVerificationRuns({
    caseId: reviewCase.id,
    limit: 10,
  });

  assert.equal(actionResult.reviewCase?.status, "resolved");
  assert.equal(updated.status, "archived");
  assert.equal(updated.lattice?.operationalStatus, "retired");
  assert.equal(updated.lattice?.reviewAction, "none");
  assert.equal((updated.evidence?.length ?? 0) >= 1, true);
  assert.equal((updated.transitions?.length ?? 0) >= 1, true);
  assert.equal(latestCase?.status, "resolved");
  assert.equal(verificationRuns.some((row) => row.resultStatus === "passed"), true);
});

test("memory consolidation writes explainable artifacts and relationship repairs", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-consolidation",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-consolidation",
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    const episodic = await service.capture({
      content: "Decision: keep the kiln dashboard browser-first until the live control tower stabilizes.",
      source: "manual",
      metadata: {
        subject: "Kiln dashboard continuity",
      },
      tags: ["decision"],
    });
    const canonical = await service.capture({
      content: "Decision: keep the kiln dashboard browser-first until the live control tower stabilizes.",
      source: "repo-markdown",
      metadata: {
        subject: "Kiln dashboard continuity",
        corpusRecordId: "repo-record-1",
        sourceArtifactPath: "docs/kiln-dashboard.md",
      },
      tags: ["decision"],
    });

    const result = await service.consolidate({
      mode: "idle",
      runId: "test-consolidation-run",
      maxCandidates: 20,
      maxWrites: 10,
      timeBudgetMs: 30_000,
      focusAreas: ["kiln-dashboard"],
    });

    assert.equal(result.promotionCount, 1);
    assert.equal(result.archiveCount, 1);
    assert.equal(result.softClusterCount, 1);
    assert.equal(result.connectionNoteCount, 1);
    assert.equal(Array.isArray(result.repairDetails), true);
    assert.equal(Array.isArray(result.promotionDetails), true);
    assert.equal(Array.isArray(result.connectionNoteDetails), true);
    assert.equal(Array.isArray((result as { writeAudit?: Array<Record<string, unknown>> }).writeAudit), true);
    assert.equal(Array.isArray((result as { phaseAudit?: Array<Record<string, unknown>> }).phaseAudit), true);
    assert.equal(Array.isArray((result as { decisionAudit?: Array<Record<string, unknown>> }).decisionAudit), true);
    assert.equal(
      ((result as { writeAudit?: Array<Record<string, unknown>> }).writeAudit ?? []).some(
        (entry) => entry.action === "promotion" && entry.writeKind === "memory-record",
      ),
      true,
    );
    assert.equal(
      ((result as { writeAudit?: Array<Record<string, unknown>> }).writeAudit ?? []).some(
        (entry) => entry.action === "archive" && entry.phase === "promotionEvaluation",
      ),
      true,
    );
    assert.equal(
      ((result as { decisionAudit?: Array<Record<string, unknown>> }).decisionAudit ?? []).some(
        (entry) => entry.decision === "promotion" && (entry.status === "promoted" || entry.status === "skipped"),
      ),
      true,
    );
    assert.equal(
      ((result as { phaseAudit?: Array<Record<string, unknown>> }).phaseAudit ?? []).some(
        (entry) => entry.phase === "candidateSelection" && entry.event === "complete",
      ),
      true,
    );
    assert.equal(result.repairDetails?.[0]?.clusterKey != null, true);
    assert.equal(result.promotionDetails?.[0]?.status, "promoted");
    assert.equal(result.connectionNoteDetails?.[0]?.topic != null, true);
    assert.equal((result as { actionabilityStatus?: string }).actionabilityStatus, "passed");
    assert.equal(Number((result as { actionableInsightCount?: number }).actionableInsightCount ?? 0) >= 1, true);
    assert.equal(Number((result as { topActions?: string[] }).topActions?.length ?? 0) >= 2, true);

    const rows = await service.getByIds({
      ids: [episodic.id, canonical.id],
      includeArchived: true,
    });
    assert.equal(rows.find((row) => row.id === episodic.id)?.status, "archived");
    assert.equal(rows.find((row) => row.id === canonical.id)?.status, "accepted");

    const promotedRows = await service.search({
      query: "kiln dashboard browser-first control tower stabilizes",
      layerAllowlist: ["canonical"],
    });
    assert.equal(promotedRows.some((row) => row.source === "memory-consolidation-promoted"), true);

    const connectionRows = await service.search({
      query: "Dream connection note kiln dashboard browser-first live control tower stabilizes",
      layerAllowlist: ["episodic"],
    });
    assert.equal(connectionRows.some((row) => row.source === "memory-consolidation-connection"), true);

    const signalPresence = await adapter.hasSignalIndex?.({
      tenantId: "tenant-consolidation",
      memoryId: canonical.id,
      edgeKeys: [{ targetId: episodic.id, relationType: "duplicate-of" }],
    });
    assert.equal(typeof signalPresence === "object" || signalPresence == null, true);

    assert.equal(existsSync(artifactPath), true);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      summary?: string;
      softClusterCount?: number;
      connectionNoteCount?: number;
      repairDetails?: Array<Record<string, unknown>>;
      connectionNoteDetails?: Array<Record<string, unknown>>;
      writeAudit?: Array<Record<string, unknown>>;
      phaseAudit?: Array<Record<string, unknown>>;
      decisionAudit?: Array<Record<string, unknown>>;
    };
    assert.match(String(artifact.summary || ""), /promoted 1, archived 1/i);
    assert.match(String(artifact.summary || ""), /wrote 1 connection notes?/i);
    assert.equal(artifact.softClusterCount, 1);
    assert.equal(artifact.connectionNoteCount, 1);
    assert.equal(Array.isArray(artifact.repairDetails), true);
    assert.equal(Array.isArray(artifact.connectionNoteDetails), true);
    assert.equal(Array.isArray(artifact.writeAudit), true);
    assert.equal(Array.isArray(artifact.phaseAudit), true);
    assert.equal(Array.isArray(artifact.decisionAudit), true);
    assert.equal(Number((artifact.writeAudit ?? []).length) >= 1, true);
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory consolidation widens beyond the freshest rows to recover older related memories", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-wide-dream",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-wide-dream",
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    await service.capture({
      content: "Decision: keep the kiln dashboard browser-first continuity contract alive for staff operations.",
      source: "manual",
      metadata: {
        subject: "Kiln dashboard continuity contract",
      },
      tags: ["decision"],
    });
    await service.capture({
      content: "Decision: keep the kiln dashboard browser-first continuity contract alive for staff operations.",
      source: "repo-markdown",
      metadata: {
        subject: "Kiln dashboard continuity contract",
        corpusRecordId: "repo-wide-1",
        sourceArtifactPath: "docs/kiln-dashboard.md",
      },
      tags: ["decision"],
    });

    for (let index = 0; index < 5; index += 1) {
      await service.capture({
        content: `Discord scratch ${index}: unrelated staffing chatter for another lane.`,
        source: "thread-scratch",
        metadata: { channelId: `ops-${index}` },
      });
    }

    const result = await service.consolidate({
      mode: "idle",
      runId: "test-wide-dream-run",
      maxCandidates: 2,
      maxWrites: 12,
      timeBudgetMs: 30_000,
      focusAreas: ["kiln dashboard continuity contract"],
    });

    assert.equal(result.promotionCount, 1);
    assert.equal(result.archiveCount, 1);
    assert.equal(result.connectionNoteCount, 1);
    assert.equal(
      Number((result.candidateSelectionDetails as Record<string, unknown> | undefined)?.recentCreatedCount ?? 0),
      2,
    );
    assert.equal(
      Number((result.candidateSelectionDetails as Record<string, unknown> | undefined)?.queryExpansionCount ?? 0) >= 2,
      true,
    );
    assert.equal(
      Number((result.candidateSelectionDetails as Record<string, unknown> | undefined)?.uniqueCandidateCount ?? 0) > 2,
      true,
    );
    assert.equal(
      Array.isArray((result.candidateSelectionDetails as Record<string, unknown> | undefined)?.byFamily),
      true,
    );

    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      candidateSelectionDetails?: Record<string, unknown>;
      connectionNoteCount?: number;
    };
    assert.equal(Number(artifact.connectionNoteCount ?? 0), 1);
    assert.equal(Array.isArray(artifact.candidateSelectionDetails?.querySeeds), true);
    assert.equal(Number(artifact.candidateSelectionDetails?.queryExpansionCount ?? 0) >= 2, true);
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory consolidation uses association intents for themed bundles", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-association-intents",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-association-intents",
    associationScout: {
      async scout(bundle) {
        if (bundle.bundleType !== "theme-cluster") return null;
        return {
          theme: "approval summary before action",
          summary: "These memories describe the same operating habit: summarize approvals before proposing action.",
          confidence: 0.81,
          contradictions: [],
          followUpQueries: ["approval summary concierge runbook"],
          intents: [
            {
              type: "connection_note",
              confidence: 0.84,
              title: "approval summary before action",
              explanation: "Write a synthesized note linking the operator habit and the runbook fragment.",
              memoryIds: bundle.rows.map((row) => row.id).slice(0, 2),
              targetIds: [],
              recommendation: "Keep this as an accepted episodic bridge until stronger canonical support lands.",
            },
            {
              type: "repair_edges",
              confidence: 0.76,
              title: "approval summary relation",
              explanation: "Link the runbook fragment back to the operator habit as the same operating thread.",
              memoryIds: bundle.rows.slice(0, 1).map((row) => row.id),
              targetIds: bundle.rows.slice(1, 2).map((row) => row.id),
              relationType: "operates-with",
            },
          ],
          provider: "test.stub",
          model: "mini-association",
        };
      },
    },
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    await service.capture({
      content: "Operator note: summarize pending approvals before suggesting any next action in Discord.",
      source: "manual",
      metadata: {
        subject: "Discord concierge approval summary",
        channelId: "ops-approvals",
        threadEvidence: "explicit",
        threadKey: "discord-approval-summary",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:discord-approval-summary"],
      },
      tags: ["decision"],
      memoryType: "episodic",
      memoryLayer: "episodic",
      status: "accepted",
    });
    await service.capture({
      content: "Runbook fragment: when approvals pile up, post a compact approval summary before any write suggestion.",
      source: "repo-markdown",
      metadata: {
        subject: "Discord concierge approval summary",
        corpusRecordId: "repo-association-1",
        sourceArtifactPath: "docs/discord-concierge.md",
        threadEvidence: "explicit",
        threadKey: "discord-approval-summary",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:discord-approval-summary"],
      },
      tags: ["runbook"],
    });
    await service.capture({
      content: "Scratch: unrelated kiln scheduling chatter for another lane.",
      source: "thread-scratch",
      metadata: { channelId: "kiln-lane" },
    });

    const result = await service.consolidate({
      mode: "idle",
      runId: "test-association-intent-run",
      maxCandidates: 3,
      maxWrites: 10,
      timeBudgetMs: 30_000,
      focusAreas: ["discord concierge approval summary"],
    });

    assert.equal(result.archiveCount, 0);
    assert.equal(result.connectionNoteCount, 1);
    assert.equal(Number(result.associationBundleCount ?? 0) >= 1, true);
    assert.equal(Number(result.associationIntentCount ?? 0) >= 2, true);

    const connectionRows = await service.search({
      query: "approval summary before action synthesized note operator habit runbook fragment",
      layerAllowlist: ["episodic"],
    });
    const intentRow = connectionRows.find((row) => row.source === "memory-consolidation-connection");
    assert.equal(Boolean(intentRow), true);
    assert.equal(
      ((intentRow?.metadata as Record<string, unknown>)?.associationScout as Record<string, unknown>)?.provider,
      "test.stub",
    );

    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      associationBundleCount?: number;
      associationIntentCount?: number;
      associationDetails?: Array<Record<string, unknown>>;
      themeClusterCount?: number;
    };
    assert.equal(Number(artifact.associationBundleCount ?? 0) >= 1, true);
    assert.equal(Number(artifact.associationIntentCount ?? 0) >= 2, true);
    assert.equal(Array.isArray(artifact.associationDetails), true);
    assert.equal(Number(artifact.themeClusterCount ?? 0) >= 1, true);
    assert.equal(
      Array.isArray((artifact as { writeAudit?: Array<Record<string, unknown>> }).writeAudit),
      true,
    );
    assert.equal(
      Array.isArray((artifact as { decisionAudit?: Array<Record<string, unknown>> }).decisionAudit),
      true,
    );
    assert.equal(
      ((artifact as { writeAudit?: Array<Record<string, unknown>> }).writeAudit ?? []).some(
        (entry) => entry.action === "connection-note" && entry.phase === "associationScout",
      ),
      true,
    );
    assert.equal(
      ((artifact as { decisionAudit?: Array<Record<string, unknown>> }).decisionAudit ?? []).some(
        (entry) => entry.decision === "bundle-evaluated" && entry.phase === "associationScout",
      ),
      true,
    );
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory consolidation source balancing caps raw compaction share when other families are available", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-source-balance",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-source-balance",
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    for (let index = 0; index < 10; index += 1) {
      await service.capture({
        content: `Canonical continuity memory ${index} for operator recall balance.`,
        source: "repo-markdown",
        metadata: {
          corpusRecordId: `repo-balance-${index}`,
          sourceArtifactPath: `docs/balance-${index}.md`,
          subject: `balance-${index}`,
        },
        status: "accepted",
        memoryLayer: "canonical",
      });
      await service.capture({
        content: `Episodic accepted memory ${index} for operator recall balance.`,
        source: "manual",
        metadata: {
          subject: `balance-${index}`,
          threadKey: `balance-thread-${index}`,
        },
        status: "accepted",
        memoryLayer: "episodic",
        memoryType: "episodic",
      });
      await service.capture({
        content: `Channel evidence ${index} from Discord/manual operations for recall balance.`,
        source: `discord:ops:${index}`,
        metadata: {
          subject: `balance-${index}`,
          channelId: `ops-${index}`,
        },
        status: "accepted",
        memoryLayer: "episodic",
        memoryType: "episodic",
      });
      await service.capture({
        content: `Compaction promoted memory ${index} should not dominate dream intake.`,
        source: "codex-compaction-promoted",
        metadata: {
          subject: `balance-${index}`,
        },
        status: "accepted",
        memoryLayer: "episodic",
        memoryType: "episodic",
      });
      await service.capture({
        content: `Working scratch ${index} for the active operator thread.`,
        source: "thread-scratch",
        metadata: {
          channelId: `scratch-${index}`,
          subject: `balance-${index}`,
        },
      });
    }
    for (let index = 0; index < 30; index += 1) {
      await service.capture({
        content: `Raw compaction row ${index} with stale operational overlap.`,
        source: "codex-compaction-raw",
        metadata: {
          subject: `raw-balance-${index % 4}`,
        },
        status: "proposed",
        memoryLayer: "episodic",
        memoryType: "episodic",
      });
    }

    const result = await service.consolidate({
      mode: "idle",
      runId: "test-source-balance-run",
      maxCandidates: 12,
      maxWrites: 2,
      timeBudgetMs: 30_000,
      focusAreas: ["operator recall balance"],
    });

    const selection = result.candidateSelectionDetails as Record<string, unknown>;
    const actual = (selection.familyQuotaActual as Array<Record<string, unknown>>) || [];
    const rawEntry = actual.find((entry) => entry.family === "compaction-raw");
    const rawSelected = Number(rawEntry?.selectedCount ?? 0);
    const totalSelected = Number(selection.postBalanceCandidateCount ?? 0);
    assert.equal(totalSelected > 0, true);
    assert.equal(rawSelected / totalSelected <= 0.2, true);
    assert.equal(
      ((selection.dominanceWarnings as string[] | undefined) ?? []).some((entry) => /compaction-raw/i.test(entry)),
      false,
    );
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory consolidation confirms associative promotion candidates on the second pass", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-promotion-candidate",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-promotion-candidate",
    associationScout: {
      async scout(bundle) {
        if (bundle.bundleType === "theme-cluster") {
          return {
            theme: "approval summary concierge pattern",
            summary: "These memories describe the same durable operating pattern around approval summaries before action.",
            confidence: 0.83,
            contradictions: [],
            followUpQueries: ["approval summary followup"],
            intents: [
              {
                type: "promotion_candidate",
                confidence: 0.82,
                title: "approval summary concierge pattern",
                explanation: "This bundle looks durable enough to become a canonical candidate after replay.",
                memoryIds: bundle.rows.map((row) => row.id).slice(0, 3),
                targetIds: [],
              },
            ],
            provider: "test.stub",
            model: "mini-association",
          };
        }
        if (bundle.bundleType === "synthesis-bundle") {
          return {
            theme: "approval summary concierge pattern",
            summary: "Replay confirmed the same durable operating pattern with broader support.",
            confidence: 0.88,
            contradictions: [],
            followUpQueries: [],
            intents: [
              {
                type: "promotion_candidate",
                confidence: 0.86,
                title: "approval summary concierge pattern",
                explanation: "The replay bundle confirms the earlier thesis strongly enough for canonical promotion.",
                memoryIds: bundle.rows.map((row) => row.id).slice(0, 4),
                targetIds: [],
              },
            ],
            provider: "test.stub",
            model: "mini-association",
          };
        }
        return null;
      },
    },
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    await service.capture({
      content: "Operator note: summarize pending approvals before suggesting the next Discord action.",
      source: "manual",
      metadata: {
        subject: "Approval summary concierge pattern",
        threadKey: "approval-summary-pattern",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:approval-summary-pattern"],
      },
      status: "accepted",
      memoryLayer: "episodic",
      memoryType: "episodic",
      tags: ["decision"],
    });
    await service.capture({
      content: "Runbook fragment: post a compact approval summary before any write suggestion when approvals pile up.",
      source: "repo-markdown",
      metadata: {
        subject: "Approval summary concierge pattern",
        threadKey: "approval-summary-pattern",
        corpusRecordId: "repo-promotion-candidate-1",
        sourceArtifactPath: "docs/discord-concierge.md",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:approval-summary-pattern"],
      },
      status: "accepted",
      memoryLayer: "canonical",
      tags: ["runbook"],
    });
    await service.capture({
      content: "Discord ops memory: approvals should be summarized before action during concierge escalations.",
      source: "discord:ops:approval-summary",
      metadata: {
        subject: "Approval summary concierge pattern",
        threadKey: "approval-summary-pattern",
        channelId: "ops-approval-summary",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:approval-summary-pattern"],
      },
      status: "accepted",
      memoryLayer: "episodic",
      memoryType: "episodic",
    });
    await service.capture({
      content: "Followup evidence: approval summary followup confirms the concierge pattern is durable.",
      source: "manual",
      metadata: {
        subject: "Approval summary concierge pattern",
        threadKey: "approval-summary-pattern-followup",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:approval-summary-pattern"],
      },
      status: "accepted",
      memoryLayer: "episodic",
      memoryType: "episodic",
    });

    const result = await service.consolidate({
      mode: "overnight",
      runId: "test-promotion-candidate-run",
      maxCandidates: 6,
      maxWrites: 10,
      timeBudgetMs: 60_000,
      focusAreas: ["approval summary concierge"],
    });

    const canonicalResults = await service.search({
      query: "approval summary concierge pattern durable operating pattern canonical",
      layerAllowlist: ["canonical"],
    });
    assert.equal(canonicalResults.some((row) => row.source === "memory-consolidation-promoted"), true);
    assert.equal(Number((result as { synthesisBundleCount?: number }).synthesisBundleCount ?? 0) >= 1, true);
    assert.equal(Number((result as { secondPassQueriesUsed?: number }).secondPassQueriesUsed ?? 0) >= 1, true);
    assert.equal(Number((result as { promotionCandidateConfirmedCount?: number }).promotionCandidateConfirmedCount ?? 0) >= 1, true);

    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      queryReplayDetails?: Array<Record<string, unknown>>;
      promotionCandidateDetails?: Array<Record<string, unknown>>;
      promotionCandidateConfirmedCount?: number;
      synthesisBundleCount?: number;
    };
    assert.equal(Number(artifact.synthesisBundleCount ?? 0) >= 1, true);
    assert.equal(Array.isArray(artifact.queryReplayDetails), true);
    assert.equal(Number(artifact.promotionCandidateConfirmedCount ?? 0) >= 1, true);
    assert.equal(
      (artifact.promotionCandidateDetails ?? []).some((entry) => entry.status === "confirmed"),
      true,
    );
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory search and context exclude dream promotion candidates by default", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-promotion-filter",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-promotion-filter",
  });

  await service.capture({
    id: "dream-promotion-candidate:test",
    content: "Dream promotion candidate: approval summary concierge pattern.",
    source: "memory-consolidation-promotion-candidate",
    status: "proposed",
    memoryLayer: "episodic",
    memoryType: "episodic",
    metadata: {
      thesisFingerprint: "fp-1",
      candidateForLayer: "canonical",
    },
  });

  const defaultSearch = await service.search({
    query: "approval summary concierge pattern",
  });
  const explicitSearch = await service.search({
    query: "approval summary concierge pattern",
    sourceAllowlist: ["memory-consolidation-promotion-candidate"],
  });
  const defaultContext = await service.context({
    query: "approval summary concierge pattern",
    maxItems: 8,
    scanLimit: 24,
  });

  assert.equal(defaultSearch.some((row) => row.source === "memory-consolidation-promotion-candidate"), false);
  assert.equal(explicitSearch.some((row) => row.source === "memory-consolidation-promotion-candidate"), true);
  assert.equal(
    (defaultContext.items ?? []).some((row) => row.source === "memory-consolidation-promotion-candidate"),
    false,
  );
});

test("memory service does not default pseudo decision traces into accepted episodic memory", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-pseudo-decision",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-pseudo-decision",
  });

  const trace = await service.capture({
    content: "Context loaded via fallback retrieval for startup query replay.",
    source: "codex",
    tags: ["decision"],
  });

  assert.equal(trace.status, "proposed");
});

test("memory consolidation suppresses pseudo decision traces from candidate selection and query seeds", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-pseudo-filter",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-pseudo-filter",
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    await service.capture({
      content: "Context loaded via fallback retrieval for startup query replay.",
      source: "codex",
      tags: ["decision"],
    });
    await service.capture({
      content: "Decision: summarize approvals before action so the operator sees the full lane state.",
      source: "manual",
      tags: ["decision"],
      status: "accepted",
      memoryLayer: "episodic",
      memoryType: "episodic",
    });
    await service.capture({
      content: "Decision: summarize approvals before action so the operator sees the full lane state.",
      source: "repo-markdown",
      metadata: {
        sourceArtifactPath: "docs/approval-summary.md",
        corpusRecordId: "repo-approval-summary",
      },
      status: "accepted",
      memoryLayer: "canonical",
      memoryType: "semantic",
    });

    const result = await service.consolidate({
      mode: "idle",
      runId: "test-pseudo-filter-run",
      maxCandidates: 6,
      maxWrites: 8,
      timeBudgetMs: 30_000,
      focusAreas: ["approval summary before action"],
    }) as {
      candidateSelectionDetails?: { suppressedPseudoDecisionCount?: number; querySeeds?: string[] };
    };

    assert.equal(Number(result.candidateSelectionDetails?.suppressedPseudoDecisionCount ?? 0) >= 1, true);
    assert.equal(
      (result.candidateSelectionDetails?.querySeeds ?? []).some((entry) => String(entry).toLowerCase().includes("startup query")),
      false,
    );
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory consolidation quarantines contradictory mail-thread merges and suppresses misleading connection notes", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-mail-quarantine",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-mail-quarantine",
    associationScout: {
      async scout(bundle) {
        if (bundle.bundleType !== "theme-cluster") return null;
        return {
          theme: "unknown mail-thread merge",
          summary: "These memories were grouped together, but the thread appears over-merged across unrelated mail topics.",
          confidence: 0.88,
          contradictions: ["Subjects drift across years.", "Participants do not overlap enough to trust a single thread."],
          followUpQueries: ["unknown mail thread merge"],
          intents: [
            {
              type: "connection_note",
              confidence: 0.86,
              title: "unknown mail-thread merge",
              explanation: "Draft a readable bridge note for the suspected merged mail thread.",
              memoryIds: bundle.rows.map((row) => row.id).slice(0, 2),
              targetIds: [],
              recommendation: "Keep this association as a readable intent thread until stronger corroboration lands.",
            },
            {
              type: "quarantine_candidate",
              confidence: 0.93,
              title: "unknown mail-thread merge quarantine",
              explanation: "The merged mail thread should be quarantined before any durable promotion.",
              memoryIds: bundle.rows.map((row) => row.id).slice(0, 3),
              targetIds: [],
            },
          ],
          provider: "test.stub",
          model: "mini-association",
        };
      },
    },
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    await service.capture({
      content: "Operator note: thread A covered approval follow-ups for the unknown mail thread.",
      source: "manual",
      metadata: {
        subject: "Unknown mail thread",
        subjectKey: "unknown-mail-thread",
        patternHints: ["thread:unknown-mail-thread"],
      },
      status: "accepted",
      memoryLayer: "episodic",
      memoryType: "episodic",
    });
    await service.capture({
      content: "Runbook fragment: unknown mail thread was later reused for archival cleanup.",
      source: "repo-markdown",
      metadata: {
        subject: "Unknown mail thread",
        subjectKey: "unknown-mail-thread",
        sourceArtifactPath: "docs/unknown-mail-thread.md",
        corpusRecordId: "repo-mail-quarantine",
        patternHints: ["thread:unknown-mail-thread"],
      },
      status: "accepted",
      memoryLayer: "canonical",
      memoryType: "semantic",
    });
    await service.capture({
      content: "Mail import note: unknown mail thread also points at unrelated historical outreach.",
      source: "mail:ops",
      metadata: {
        subject: "Unknown mail thread",
        subjectKey: "unknown-mail-thread",
        patternHints: ["thread:unknown-mail-thread"],
      },
      status: "accepted",
      memoryLayer: "episodic",
      memoryType: "episodic",
    });

    const result = await service.consolidate({
      mode: "idle",
      runId: "test-mail-quarantine-run",
      maxCandidates: 8,
      maxWrites: 10,
      timeBudgetMs: 30_000,
      focusAreas: ["unknown mail thread merge"],
    }) as {
      quarantineCount?: number;
      connectionNoteCount?: number;
      suppressedConnectionNoteCount?: number;
      actionabilityStatus?: string;
      topActions?: string[];
    };

    assert.equal(result.quarantineCount, 1);
    assert.equal(result.connectionNoteCount, 0);
    assert.equal(Number(result.suppressedConnectionNoteCount ?? 0) >= 1, true);
    assert.equal(result.actionabilityStatus, "passed");
    assert.equal(Number(result.topActions?.length ?? 0) >= 2, true);
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory consolidation suppresses unchanged connection notes on rerun", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-unchanged-connection-note",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-unchanged-connection-note",
    associationScout: {
      async scout(bundle) {
        if (bundle.bundleType !== "theme-cluster") return null;
        return {
          theme: "approval summary before action",
          summary: "These memories describe the same operator habit of summarizing approvals before action.",
          confidence: 0.82,
          contradictions: [],
          followUpQueries: [],
          intents: [
            {
              type: "connection_note",
              confidence: 0.9,
              title: "approval summary before action",
              explanation: "Write one readable bridge note for the approval summary habit.",
              memoryIds: bundle.rows.map((row) => row.id).slice(0, 2),
              targetIds: [],
              recommendation: "Review the approval summary thread before the next operator handoff.",
            },
          ],
          provider: "test.stub",
          model: "mini-association",
        };
      },
    },
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    await service.capture({
      content: "Operator note: summarize approvals before suggesting any next step.",
      source: "manual",
      metadata: {
        subject: "Approval summary thread",
        subjectKey: "approval-summary-thread",
        patternHints: ["thread:approval-summary-thread"],
      },
      status: "accepted",
      memoryLayer: "episodic",
      memoryType: "episodic",
    });
    await service.capture({
      content: "Runbook fragment: summarize approvals before suggesting any next step.",
      source: "repo-markdown",
      metadata: {
        subject: "Approval summary thread",
        subjectKey: "approval-summary-thread",
        sourceArtifactPath: "docs/approval-summary-thread.md",
        corpusRecordId: "repo-approval-thread",
        patternHints: ["thread:approval-summary-thread"],
      },
      status: "accepted",
      memoryLayer: "canonical",
      memoryType: "semantic",
    });

    const first = await service.consolidate({
      mode: "idle",
      runId: "test-unchanged-connection-first",
      maxCandidates: 6,
      maxWrites: 8,
      timeBudgetMs: 30_000,
      focusAreas: ["approval summary before action"],
    }) as { connectionNoteCount?: number };
    const second = await service.consolidate({
      mode: "idle",
      runId: "test-unchanged-connection-second",
      maxCandidates: 6,
      maxWrites: 8,
      timeBudgetMs: 30_000,
      focusAreas: ["approval summary before action"],
    }) as { connectionNoteCount?: number; suppressedConnectionNoteCount?: number };

    assert.equal(first.connectionNoteCount, 1);
    assert.equal(second.connectionNoteCount, 0);
    assert.equal(Number(second.suppressedConnectionNoteCount ?? 0) >= 1, true);
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory consolidation surfaces unavailable association scout status in the artifact", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-association-unavailable",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-association-unavailable",
    associationScout: null,
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    await service.capture({
      content: "Operator note: summarize pending approvals before suggesting any next action in Discord.",
      source: "manual",
      metadata: {
        subject: "Discord concierge approval summary",
        threadEvidence: "explicit",
        threadKey: "discord-approval-summary",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:discord-approval-summary"],
      },
      tags: ["decision"],
      memoryType: "episodic",
      memoryLayer: "episodic",
      status: "accepted",
    });
    await service.capture({
      content: "Runbook fragment: when approvals pile up, post a compact approval summary before any write suggestion.",
      source: "repo-markdown",
      metadata: {
        subject: "Discord concierge approval summary",
        corpusRecordId: "repo-association-unavailable-1",
        sourceArtifactPath: "docs/discord-concierge.md",
        threadEvidence: "explicit",
        threadKey: "discord-approval-summary",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:discord-approval-summary"],
      },
      tags: ["runbook"],
    });

    const result = await service.consolidate({
      mode: "idle",
      runId: "test-association-unavailable-run",
      maxCandidates: 3,
      maxWrites: 6,
      timeBudgetMs: 30_000,
      focusAreas: ["discord concierge approval summary"],
    });

    assert.equal(Number(result.themeClusterCount ?? 0) >= 1, true);
    assert.equal(Number(result.associationBundleCount ?? 0), 0);

    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      summary?: string;
      themeClusterCount?: number;
      associationScoutStatus?: Record<string, unknown>;
      associationErrors?: Array<Record<string, unknown>>;
    };
    assert.equal(Number(artifact.themeClusterCount ?? 0) >= 1, true);
    assert.equal(artifact.associationScoutStatus?.available, false);
    assert.equal(artifact.associationScoutStatus?.reason, "disabled");
    assert.match(String(artifact.summary || ""), /association scout unavailable/i);
    assert.equal(Array.isArray(artifact.associationErrors), true);
    assert.match(String(artifact.associationErrors?.[0]?.error || ""), /association scout unavailable/i);
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory consolidation disables association scout after nonretryable auth failure", { concurrency: false }, async () => {
  const adapter = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store: adapter,
    defaultTenantId: "tenant-association-auth-failure",
    defaultAgentId: "agent:codex",
    defaultRunId: "run-association-auth-failure",
    associationScout: {
      async scout() {
        throw new Error("401 Unauthorized: refresh token reused and access token could not be refreshed");
      },
    },
  });
  const artifactPath = memoryConsolidationArtifactPath();
  rmSync(artifactPath, { force: true });

  try {
    await service.capture({
      content: "Operator note: summarize pending approvals before suggesting any next action in Discord.",
      source: "manual",
      metadata: {
        subject: "Discord concierge approval summary",
        threadKey: "discord-approval-summary",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:discord-approval-summary"],
      },
      tags: ["decision"],
      memoryType: "episodic",
      memoryLayer: "episodic",
      status: "accepted",
    });
    await service.capture({
      content: "Runbook fragment: when approvals pile up, post a compact approval summary before any write suggestion.",
      source: "repo-markdown",
      metadata: {
        subject: "Discord concierge approval summary",
        threadKey: "discord-approval-summary",
        entityHints: ["concept:approval-summary", "role:discord-concierge"],
        patternHints: ["workflow:approval-summary", "thread:discord-approval-summary"],
      },
      tags: ["runbook"],
      memoryType: "semantic",
      memoryLayer: "canonical",
      status: "accepted",
    });

    const result = await service.consolidate({
      mode: "idle",
      runId: "test-association-auth-failure-run",
      maxCandidates: 3,
      maxWrites: 6,
      timeBudgetMs: 30_000,
      focusAreas: ["discord concierge approval summary"],
    }) as { associationBundleCount?: number };

    assert.equal(Number(result.associationBundleCount ?? 0), 1);
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
      associationScoutStatus?: Record<string, unknown>;
      associationErrors?: Array<Record<string, unknown>>;
    };
    assert.equal(artifact.associationScoutStatus?.available, false);
    assert.equal(artifact.associationScoutStatus?.reason, "provider-auth-failed");
    assert.match(String(artifact.associationErrors?.[0]?.error || ""), /refresh token/i);
    assert.equal(String(artifact.associationErrors?.[0]?.error || "").length <= 1200, true);
  } finally {
    rmSync(artifactPath, { force: true });
  }
});

test("memory service importBatch reports failures when continueOnError=false", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-b",
  });

  const result = await service.importBatch({
    continueOnError: false,
    items: [{ content: "valid row" }, { content: "" }, { content: "unreached row" }],
  });

  assert.equal(result.imported, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results.length, 2);
  assert.equal(result.results[1]?.ok, false);
});

test("memory service importBatch preserves per-row source when no sourceOverride is supplied", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-import-preserve",
  });

  await service.importBatch({
    items: [
      {
        id: "mem-row-repo",
        content: "Repo markdown row should keep repo-markdown as source.",
        source: "repo-markdown",
        clientRequestId: "row-repo-1",
        metadata: {
          projectLane: "monsoonfire-portal",
          corpusRecordId: "fact-portal-1",
        },
      },
      {
        id: "mem-row-codex",
        content: "Codex resumable row should keep codex-resumable-session as source.",
        source: "codex-resumable-session",
        clientRequestId: "row-codex-1",
        metadata: {
          projectLane: "monsoonfire-portal",
          corpusRecordId: "fact-portal-2",
        },
      },
    ],
  });

  const rows = await service.getByIds({
    ids: ["mem-row-repo", "mem-row-codex"],
    includeArchived: true,
  });

  assert.equal(rows[0]?.source, "repo-markdown");
  assert.equal(rows[1]?.source, "codex-resumable-session");
  assert.equal(rows[0]?.metadata.corpusRecordId, "fact-portal-1");
  assert.equal(rows[1]?.metadata.projectLane, "monsoonfire-portal");
});

test("memory service importBatch honors explicit sourceOverride when intentionally supplied", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-import-override",
  });

  await service.importBatch({
    sourceOverride: "import",
    items: [
      {
        id: "mem-row-override",
        content: "Explicit overrides should still be honored for archive/replay batches.",
        source: "repo-markdown",
        clientRequestId: "row-override-1",
      },
    ],
  });

  const [row] = await service.getByIds({
    ids: ["mem-row-override"],
    includeArchived: true,
  });

  assert.equal(row?.source, "import");
});

test("repo markdown rows do not synthesize thread lineage without real thread evidence", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-thread-evidence",
  });

  const row = await service.capture({
    content: "Portal dashboard documentation notes and implementation outline.",
    source: "repo-markdown",
    metadata: {
      subject: "Portal dashboard docs",
    },
  });

  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.threadEvidence, "none");
  assert.equal(typeof metadata.threadKey, "undefined");
  assert.equal(Array.isArray(metadata.patternHints), true);
  assert.equal((metadata.patternHints as string[]).includes("structure:has-thread"), false);
});

test("mail-like rows retain derived thread evidence for relationship indexing", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-mail-thread-evidence",
  });

  const row = await service.capture({
    content: "Re: kiln queue blocker follow-up with references and next action.",
    source: "email",
    metadata: {
      subject: "Re: Kiln queue blocker",
      from: "owner@example.com",
      to: "team@example.com",
      normalizedMessageId: "<msg-2@example.com>",
      inReplyToNormalized: "<msg-1@example.com>",
      referenceMessageIds: ["<msg-1@example.com>"],
    },
  });

  const metadata = (row.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.threadEvidence, "derived");
  assert.equal(typeof metadata.threadKey, "string");
  assert.notEqual(String(metadata.threadKey || "").length, 0);
});

test("synthetic thread metadata scrubber rewrites legacy non-threaded rows", async () => {
  const store = createInMemoryMemoryStoreAdapter();
  const service = createMemoryService({
    store,
    defaultTenantId: "tenant-thread-scrub",
  });

  await store.upsert({
    id: "mem-legacy-thread-noise",
    tenantId: "tenant-thread-scrub",
    agentId: "agent:import",
    runId: "import:legacy",
    content: "Imported repo notes that should not behave like an email thread.",
    source: "repo-markdown",
    tags: ["import"],
    metadata: {
      source: "repo-markdown",
      threadKey: "mail-thread:unknown",
      loopClusterKey: "thread:mail-thread:unknown",
      threadDeterministicSignature: "threadsig_legacy_noise",
      threadEvidence: "derived",
      entityHints: ["thread:mail-thread:unknown", "thread-signature:threadsig_legacy_noise"],
      patternHints: ["loop-cluster:thread:mail-thread:unknown", "structure:has-thread"],
      workstreamKey: "thread:mail-thread:unknown",
      messageStructure: {
        hasThreadKey: true,
        sourceFamily: "generic",
      },
      threadReconstructionSignals: {
        deterministicSignature: "threadsig_legacy_noise",
        hasLinkableMessagePath: false,
      },
    },
    embedding: null,
    occurredAt: null,
    clientRequestId: "legacy-thread-noise-1",
    status: "accepted",
    memoryType: "semantic",
    memoryLayer: "canonical",
    sourceConfidence: 0.75,
    importance: 0.6,
    contextualizedContent: "Imported repo notes that should not behave like an email thread.",
    fingerprint: null,
    embeddingModel: null,
    embeddingVersion: 1,
  });

  const result = await service.scrubSyntheticThreadMetadata({
    dryRun: false,
    limit: 10,
  });

  assert.equal(result.updated, 1);
  assert.equal(result.sample[0]?.beforeThreadKey, "mail-thread:unknown");
  assert.equal(result.sample[0]?.afterThreadKey, null);

  const [row] = await service.getByIds({
    ids: ["mem-legacy-thread-noise"],
    includeArchived: true,
  });

  const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
  assert.equal(metadata.threadEvidence, "none");
  assert.equal(typeof metadata.threadKey, "undefined");
  assert.equal(typeof metadata.loopClusterKey, "undefined");
  assert.equal(typeof metadata.threadDeterministicSignature, "undefined");
  assert.equal((metadata.patternHints as string[]).includes("structure:has-thread"), false);
});

test("synthetic thread metadata scrubber leaves legitimate mail threading alone", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-thread-scrub-mail",
  });

  await service.capture({
    content: "Re: real thread with actual message references.",
    source: "email",
    metadata: {
      subject: "Re: Kiln notice",
      from: "owner@example.com",
      to: "team@example.com",
      normalizedMessageId: "<msg-10@example.com>",
      inReplyToNormalized: "<msg-9@example.com>",
      referenceMessageIds: ["<msg-9@example.com>"],
    },
  });

  const result = await service.scrubSyntheticThreadMetadata({
    dryRun: true,
    limit: 10,
    includeMailLike: true,
  });

  assert.equal(result.eligible, 0);
  assert.equal(result.updated, 0);
});

test("memory nanny reroutes non-allowlisted tenant and derives stable namespace", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "monsoonfire-main",
    defaultAgentId: "studio-brain-memory",
    defaultRunId: "open-memory-v1",
    allowedTenantIds: ["monsoonfire-main"],
  });

  const row = await service.capture({
    content: "Discord note from a new agent tenant should be rerouted safely.",
    source: "discord",
    tenantId: "random-agent-space",
  });

  assert.equal(row.tenantId, "monsoonfire-main");
  assert.equal(row.agentId, "agent:discord");
  assert.equal(row.runId, "agent:discord:main");
  const nanny = (row.metadata._memoryNanny ?? {}) as Record<string, unknown>;
  assert.equal(nanny.tenantFallbackApplied, true);
  assert.equal(nanny.requestedTenantId, "random-agent-space");
  assert.equal(nanny.resolvedTenantId, "monsoonfire-main");
});

test("memory nanny suppresses fast duplicate loops without client request ids", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-loop",
    nannyDuplicateWindowMs: 60_000,
  });

  const first = await service.capture({
    content: "Loop candidate note that should not duplicate endlessly.",
    source: "codex-handoff",
  });
  const second = await service.capture({
    content: "Loop candidate note that should not duplicate endlessly.",
    source: "codex-handoff",
  });

  assert.equal(first.id.startsWith("mem_"), true);
  assert.equal(second.id.startsWith("mem_loop_"), true);
  const stats = await service.stats({});
  assert.equal(stats.total, 2);
});

test("context packs are budgeted and scoped for startup", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-context",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    content: "Intent runner is green and drift checks are passing.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
  });
  await service.capture({
    content: "Unrelated discord social memory.",
    source: "discord",
    agentId: "agent:discord",
    runId: "agent:discord:main",
  });

  const context = await service.context({
    agentId: "agent:codex",
    runId: "agent:codex:main",
    query: "intent drift",
    maxItems: 5,
    maxChars: 512,
    scanLimit: 50,
    includeTenantFallback: false,
  });

  assert.ok(context.items.length >= 1);
  assert.equal(context.selection.agentId, "agent:codex");
  assert.equal(context.selection.runId, "agent:codex:main");
  assert.ok(context.budget.usedChars <= 512);
  assert.ok(context.items.every((row) => row.agentId === "agent:codex"));
});

test("context can expand memory relationships across linked rows", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-context",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    id: "mem-root",
    content: "Session anchor: we were moving the intent runner forward.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["context-seed"],
    metadata: {
      threadKey: "continuity-thread",
      relatedMemoryIds: ["mem-follow-up"],
    },
  });
  await service.capture({
    id: "mem-follow-up",
    content: "Worker handoff pending: codex needs shell restart notes.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["context-follow-up"],
    metadata: {
      relatedMemoryIds: ["mem-root"],
    },
  });
  await service.capture({
    id: "mem-other",
    content: "Unrelated reminder that does not connect to continuity thread.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["other"],
  });

  const context = await service.context({
    agentId: "agent:codex",
    runId: "agent:codex:main",
    query: "anchor",
    maxItems: 3,
    maxChars: 1200,
    scanLimit: 50,
    includeTenantFallback: false,
    expandRelationships: true,
    maxHops: 2,
  });

  assert.equal(context.items.length >= 2, true);
  assert.ok(context.selection.expandRelationships);
  assert.equal(context.selection.relationshipExpansion.addedFromRelationships >= 1, true);
  assert.ok(context.selection.relationshipExpansion.attempted);
});

test("context can force a seed memory id before scoring", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-context-seed",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    id: "mem-seed",
    content: "Seed for explicit restart continuity.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["seed"],
  });
  await service.capture({
    id: "mem-tail",
    content: "Recent unrelated codex item with same run.",
    source: "codex-handoff",
    agentId: "agent:codex",
    runId: "agent:codex:main",
    tags: ["tail"],
  });

  const context = await service.context({
    runId: "agent:codex:main",
    agentId: "agent:codex",
    query: "unrelated",
    maxItems: 1,
    maxChars: 1200,
    scanLimit: 50,
    includeTenantFallback: false,
    seedMemoryId: "mem-seed",
  });

  assert.equal(context.selection.seedMemoryId, "mem-seed");
  assert.equal(context.items[0]?.id, "mem-seed");
});

test("project-scoped queries boost same-lane corpus-backed rows over mail noise", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-project-lane",
  });

  await service.capture({
    id: "mem-mail",
    content: "Support email thread about a generic follow up.",
    source: "mail:outlook",
    metadata: {
      projectLane: "personal",
      participants: ["support@example.com"],
    },
  });

  await service.capture({
    id: "mem-cross-lane",
    content: "Decision: real estate search coverage was updated.",
    source: "repo-markdown",
    metadata: {
      projectLane: "real-estate",
      corpusRecordId: "fact-real-estate",
      corpusManifestPath: "/tmp/real-estate-manifest.json",
      contextSignals: { decisionLike: true },
    },
    status: "accepted",
    sourceConfidence: 0.84,
  });

  await service.capture({
    id: "mem-portal",
    content: "Decision: Monsoon Fire portal memory retrieval now prefers same-project corpus rows.",
    source: "repo-markdown",
    metadata: {
      projectLane: "monsoonfire-portal",
      corpusRecordId: "fact-portal",
      corpusManifestPath: "/tmp/portal-manifest.json",
      contextSignals: { decisionLike: true },
    },
    status: "accepted",
    sourceConfidence: 0.84,
  });

  const rows = await service.search({
    query: "codex monsoonfire portal memory decisions",
    limit: 3,
  });

  assert.equal(rows[0]?.id, "mem-portal");
  assert.equal(rows[2]?.id, "mem-mail");
});

test("context prefers the explicit repo lane even when the query also mentions Studio Brain", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-project-lane-context",
  });

  await service.capture({
    id: "mem-studio",
    content: "Decision: Studio Brain auth fallback should remint staff tokens for memory continuity.",
    source: "repo-markdown",
    metadata: {
      projectLane: "studio-brain",
      corpusRecordId: "fact-studio-brain-auth",
      corpusManifestPath: "/tmp/studio-brain-manifest.json",
      contextSignals: { decisionLike: true },
    },
    status: "accepted",
    sourceConfidence: 0.84,
  });

  await service.capture({
    id: "mem-portal",
    content: "Decision: Monsoon Fire portal startup continuity should prefer portal-lane context before generic Studio Brain notes.",
    source: "repo-markdown",
    metadata: {
      projectLane: "monsoonfire-portal",
      corpusRecordId: "fact-portal-auth",
      corpusManifestPath: "/tmp/portal-auth-manifest.json",
      contextSignals: { decisionLike: true },
    },
    status: "accepted",
    sourceConfidence: 0.84,
  });

  const context = await service.context({
    query: "studio brain auth fix for monsoonfire-portal continuity",
    maxItems: 4,
    maxChars: 1600,
    scanLimit: 24,
    includeTenantFallback: false,
    sourceAllowlist: ["repo-markdown"],
  });

  const repoBackedItems = context.items.filter((row) => row.source === "repo-markdown");
  assert.equal(repoBackedItems[0]?.id, "mem-portal");
});

test("compaction-promoted memories outrank raw compaction captures for startup-style queries", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-compaction-ranking",
  });

  await service.capture({
    id: "mem-raw",
    content: "Raw tool transcript for portal memory retrieval tuning.",
    source: "codex-compaction-raw",
    metadata: {
      threadId: "thread-1",
      cwd: "D:/monsoonfire-portal",
      captureKind: "function_call_output",
    },
  });

  await service.capture({
    id: "mem-promoted",
    content: "Decision: startup retrieval should prefer promoted compaction memories for portal context.",
    source: "codex-compaction-promoted",
    metadata: {
      threadId: "thread-1",
      cwd: "D:/monsoonfire-portal",
      captureKind: "promoted",
      contextSignals: { decisionLike: true },
    },
  });

  const rows = await service.search({
    query: "portal startup retrieval promoted compaction context",
    limit: 2,
  });

  assert.equal(rows[0]?.id, "mem-promoted");
  assert.equal(rows[1]?.id, "mem-raw");
});

test("expired compaction raw rows are excluded from search and context selection", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-compaction-expiry",
    defaultAgentId: "agent:codex",
  });

  await service.capture({
    id: "mem-expired-raw",
    content: "Expired raw compaction capture about portal memory context.",
    source: "codex-compaction-raw",
    agentId: "agent:codex",
    runId: "codex-thread:expired",
    metadata: {
      threadId: "thread-expired",
      expiresAt: "2020-01-01T00:00:00.000Z",
      captureKind: "function_call_output",
    },
  });

  await service.capture({
    id: "mem-live-promoted",
    content: "Decision: keep live promoted memory for portal context bootstrap.",
    source: "codex-compaction-promoted",
    agentId: "agent:codex",
    runId: "codex-thread:expired",
    metadata: {
      threadId: "thread-expired",
      captureKind: "promoted",
    },
  });

  const searchRows = await service.search({
    query: "portal context bootstrap memory",
    limit: 5,
  });
  assert.equal(searchRows.some((row) => row.id === "mem-expired-raw"), false);
  assert.equal(searchRows.some((row) => row.id === "mem-live-promoted"), true);

  const context = await service.context({
    agentId: "agent:codex",
    runId: "codex-thread:expired",
    query: "portal context bootstrap memory",
    maxItems: 5,
    maxChars: 1200,
    scanLimit: 50,
    includeTenantFallback: false,
  });
  assert.equal(context.items.some((row) => row.id === "mem-expired-raw"), false);
  assert.equal(context.items.some((row) => row.id === "mem-live-promoted"), true);
});

test("incident action idempotency replays when occurredAt is omitted", async () => {
  const service = createMemoryService({
    store: createInMemoryMemoryStoreAdapter(),
    defaultTenantId: "tenant-incident-idempotency",
  });

  const first = await service.incidentAction({
    loopKey: "loop.audit.idempotency",
    action: "ack",
    idempotencyKey: "incident-idem-001",
    note: "same payload",
  });
  assert.equal(first.ok, true);
  assert.equal(first.idempotency.replayed, false);
  assert.ok(first.feedback);
  assert.equal(first.feedback.counts.ackCount, 1);

  const replay = await service.incidentAction({
    loopKey: "loop.audit.idempotency",
    action: "ack",
    idempotencyKey: "incident-idem-001",
    note: "same payload",
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotency.replayed, true);
  assert.equal(replay.recordedAt, first.recordedAt);
  assert.ok(replay.feedback);
  assert.equal(replay.feedback.counts.ackCount, 1);
});
