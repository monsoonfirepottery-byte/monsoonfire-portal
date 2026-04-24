"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const service_1 = require("./service");
const inMemoryAdapter_1 = require("./inMemoryAdapter");
const memoryConsolidationArtifactPath = () => (0, node_path_1.resolve)(__dirname, "..", "..", "..", "output", "studio-brain", "memory-consolidation", "latest.json");
(0, node_test_1.default)("memory service capture/search pipeline works with in-memory adapter", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "tenant-a",
    });
    const first = await service.capture({
        content: "Decision: launch moved after QA blocker review.",
        source: "manual",
        clientRequestId: "capture-1",
    });
    strict_1.default.equal(first.tenantId, "tenant-a");
    strict_1.default.ok(first.id.startsWith("mem_req_"));
    const duplicate = await service.capture({
        content: "Decision: launch moved after QA blocker review.",
        source: "manual",
        clientRequestId: "capture-1",
    });
    strict_1.default.equal(duplicate.id, first.id);
    const rows = await service.search({ query: "QA blocker" });
    strict_1.default.ok(rows.length >= 1);
    strict_1.default.equal(rows[0]?.id, first.id);
    const stats = await service.stats({});
    strict_1.default.equal(stats.total, 1);
    strict_1.default.equal(stats.bySource[0]?.source, "manual");
});
(0, node_test_1.default)("memory service derives episodic accepted decisions and working-memory TTLs", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(decision.memoryLayer, "episodic");
    strict_1.default.equal(decision.status, "accepted");
    strict_1.default.equal(decision.lattice?.category, "decision");
    strict_1.default.equal(decision.lattice?.truthStatus, "verified");
    strict_1.default.equal(decision.lattice?.freshnessStatus, "fresh");
    strict_1.default.equal(decision.lattice?.operationalStatus, "active");
    strict_1.default.equal(scratch.memoryLayer, "working");
    strict_1.default.equal(typeof scratch.metadata.expiresAt, "string");
    strict_1.default.equal(scratch.lattice?.category, "observation");
});
(0, node_test_1.default)("memory service defaults Codex trace hints into accepted episodic memory", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(trace.memoryLayer, "episodic");
    strict_1.default.equal(trace.status, "accepted");
    strict_1.default.equal(trace.metadata.memoryLayer, "episodic");
});
(0, node_test_1.default)("memory service search and stats honor layer filters", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(workingOnly.length, 1);
    strict_1.default.equal(workingOnly[0]?.memoryLayer, "working");
    strict_1.default.equal(stats.byLayer.some((entry) => entry.layer === "canonical"), true);
    strict_1.default.equal(stats.byLayer.some((entry) => entry.layer === "working"), false);
});
(0, node_test_1.default)("memory service safety-critical search filters stale and speculative memories", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(rows.some((row) => row.id === freshFact.id), true);
    strict_1.default.equal(rows.some((row) => row.id === staleFact.id), false);
    strict_1.default.equal(rows.some((row) => row.id === hypothesis.id), false);
    strict_1.default.equal(rows.every((row) => row.lattice?.freshnessStatus === "fresh"), true);
    strict_1.default.equal(rows.every((row) => row.lattice?.truthStatus === "verified" || row.lattice?.truthStatus === "trusted"), true);
});
(0, node_test_1.default)("memory service fills to a valid limit when strict retrieval filters would otherwise starve the result window", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(rows.length, 1);
    strict_1.default.equal(rows[0]?.id, trusted.id);
    strict_1.default.equal(rows[0]?.lattice?.hasEvidence, true);
});
(0, node_test_1.default)("memory lattice derives review actions and stats backlog", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    const byId = new Map(rows.map((row) => [row.id, row]));
    const stats = await service.stats({});
    strict_1.default.equal(byId.get(trusted.id)?.lattice?.reviewAction, "none");
    strict_1.default.equal(byId.get(staleFact.id)?.lattice?.reviewAction, "revalidate");
    strict_1.default.equal(byId.get(staleHypothesis.id)?.lattice?.reviewAction, "retire");
    strict_1.default.equal(byId.get(contradictedGuardrail.id)?.lattice?.reviewAction, "resolve-conflict");
    strict_1.default.equal(byId.get(contradictedGuardrail.id)?.lattice?.reviewReasons.includes("contradicted"), true);
    strict_1.default.equal(stats.lattice?.coverage.rowsWithLattice, 4);
    strict_1.default.equal(stats.lattice?.coverage.totalRows, 4);
    strict_1.default.equal(stats.lattice?.coverage.ratio, 1);
    strict_1.default.equal(stats.lattice?.backlog.reviewNow, 3);
    strict_1.default.equal(stats.lattice?.backlog.revalidate, 1);
    strict_1.default.equal(stats.lattice?.backlog.resolveConflict, 1);
    strict_1.default.equal(stats.lattice?.backlog.retire, 1);
    strict_1.default.equal(stats.lattice?.byReviewAction.some((entry) => entry.action === "resolve-conflict" && entry.count === 1), true);
});
(0, node_test_1.default)("memory capture redacts secret-bearing content, quarantines it, and emits a transition event", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "tenant-secret-hygiene",
        defaultAgentId: "agent:codex",
    });
    const captured = await service.capture({
        content: "Operator note: Authorization: Bearer test-redaction-token",
        source: "manual",
        clientRequestId: "secret-capture-1",
    });
    strict_1.default.equal(captured.status, "quarantined");
    strict_1.default.equal(captured.content.includes("[redacted-token]"), true);
    strict_1.default.equal(captured.metadata.redactionState, "redacted");
    strict_1.default.equal(captured.metadata.secretExposure.detected, true);
    strict_1.default.equal(captured.lattice?.secretExposure, true);
    strict_1.default.equal(captured.transitions?.length, 1);
    strict_1.default.equal(captured.transitions?.[0]?.toStatus, "quarantined");
});
(0, node_test_1.default)("memory search can require evidence and a minimum authority floor", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(rows.some((row) => row.id === repoFact.id), true);
    strict_1.default.equal(rows.every((row) => row.lattice?.hasEvidence === true), true);
    strict_1.default.equal(rows.every((row) => row.lattice?.authorityClass === "a0-live" || row.lattice?.authorityClass === "a1-repo"), true);
});
(0, node_test_1.default)("memory stats surface startup, secret, and shadow MCP launch findings", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
        content: "Operator note: Authorization: Bearer launch-redaction-token",
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
    strict_1.default.equal((stats.startupReadiness?.startupEligibleRows ?? 0) >= 1, true);
    strict_1.default.equal((stats.startupReadiness?.handoffRows ?? 0) >= 1, true);
    strict_1.default.equal((stats.secretExposureFindings?.canonicalBlockedRows ?? 0) >= 1, true);
    strict_1.default.equal((stats.shadowMcpFindings?.highRiskRows ?? 0) >= 1, true);
});
(0, node_test_1.default)("memory capture quarantines exact conflicting loop states and emits a conflict record", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(conflicting.lattice?.truthStatus, "contradicted");
    strict_1.default.equal(conflicting.lattice?.operationalStatus, "quarantined");
    strict_1.default.equal(conflicting.lattice?.reviewAction, "resolve-conflict");
    strict_1.default.equal(conflicting.lattice?.conflictSeverity, "hard");
    strict_1.default.equal(conflicting.lattice?.conflictKinds.includes("exact-loop-state"), true);
    strict_1.default.equal(conflicting.lattice?.conflictingMemoryIds.includes(resolved.id), true);
    const debugRows = await service.recent({
        limit: 20,
        useMode: "debugging",
    });
    const conflictRecord = debugRows.find((row) => row.source === "memory-contradiction-watch" && row.lattice?.category === "conflict-record");
    strict_1.default.ok(conflictRecord);
    strict_1.default.equal(conflictRecord?.lattice?.truthStatus, "verified");
    strict_1.default.equal(conflictRecord?.lattice?.operationalStatus, "active");
    strict_1.default.equal(Array.isArray(conflictRecord?.metadata?.conflictingMemoryIds), true);
    strict_1.default.equal((conflictRecord?.metadata?.conflictingMemoryIds).includes(conflicting.id), true);
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
    const planningById = new Map(planningRows.map((row) => [row.id, row]));
    strict_1.default.equal(operationalRows.some((row) => row.id === resolved.id), false);
    strict_1.default.equal(operationalRows.some((row) => row.id === conflicting.id), false);
    strict_1.default.equal(operationalRows.some((row) => row.id === conflictRecord?.id), false);
    strict_1.default.equal(operationalContext.items.some((row) => row.id === resolved.id), false);
    strict_1.default.equal(operationalContext.items.some((row) => row.id === conflicting.id), false);
    strict_1.default.equal(operationalContext.items.some((row) => row.id === conflictRecord?.id), false);
    strict_1.default.equal(operationalContext.summary.includes("Operational retrieval blocked by a hard conflict"), true);
    strict_1.default.equal(operationalContext.diagnostics.blockedByHardConflict?.blocked, true);
    strict_1.default.equal(operationalContext.diagnostics.blockedByHardConflict?.useMode, "operational");
    strict_1.default.equal(operationalContext.diagnostics.blockedByHardConflict?.scope, "subject:startup-continuity-auth-drift");
    strict_1.default.equal(operationalContext.diagnostics.blockedByHardConflict?.conflictRecordId === null
        || operationalContext.diagnostics.blockedByHardConflict?.conflictRecordId === conflictRecord?.id, true);
    strict_1.default.equal(operationalContext.diagnostics.blockedByHardConflict?.conflictingMemoryIds.includes(resolved.id), true);
    strict_1.default.equal(operationalContext.diagnostics.blockedByHardConflict?.conflictingMemoryIds.includes(conflicting.id), true);
    strict_1.default.equal(planningRows.some((row) => row.id === resolved.id), true);
    strict_1.default.equal(planningRows.some((row) => row.id === conflicting.id), true);
    strict_1.default.equal(planningRows.some((row) => row.id === conflictRecord?.id), true);
    strict_1.default.equal(planningById.get(resolved.id)?.lattice?.truthStatus, "contradicted");
    strict_1.default.equal(planningById.get(resolved.id)?.lattice?.operationalStatus, "quarantined");
    strict_1.default.equal(planningById.get(resolved.id)?.lattice?.reviewAction, "resolve-conflict");
    strict_1.default.equal(planningById.get(resolved.id)?.matchedBy.includes("conflict-shadow"), true);
    strict_1.default.equal(planningContext.items.some((row) => row.id === resolved.id), true);
    strict_1.default.equal(planningContext.items.some((row) => row.id === conflicting.id), true);
    strict_1.default.equal(planningContext.items.some((row) => row.id === conflictRecord?.id), true);
    strict_1.default.equal(conflictRecord?.lattice?.conflictSeverity, "hard");
    strict_1.default.equal(conflictRecord?.lattice?.reviewAction, "none");
    strict_1.default.equal(stats.lattice?.backlog.resolveConflict, 1);
    strict_1.default.equal(stats.conflictBacklog?.contestedRows, 1);
    strict_1.default.equal(stats.conflictBacklog?.quarantinedRows, 1);
    strict_1.default.equal(stats.conflictBacklog?.retrievalShadowedRows, 2);
});
(0, node_test_1.default)("memory review cases open for hard conflicts and blocked diagnostics surface review guidance", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(context.diagnostics.blockedByHardConflict?.blocked, true);
    strict_1.default.equal(Boolean(context.diagnostics.blockedByHardConflict?.reviewCaseId), true);
    strict_1.default.equal(context.diagnostics.blockedByHardConflict?.recommendedActions?.includes("accept_winner"), true);
    strict_1.default.equal(reviewCases.length >= 1, true);
    strict_1.default.equal(reviewCases[0]?.caseType, "resolve-conflict");
    strict_1.default.equal(reviewCases[0]?.linkedMemoryIds.includes(resolved.id), true);
    strict_1.default.equal(verificationRuns.length >= 1, true);
    strict_1.default.equal(verificationRuns[0]?.resultStatus === "failed" || verificationRuns[0]?.resultStatus === "needs-review", true);
    strict_1.default.equal((stats.openReviewCases ?? 0) >= 1, true);
    strict_1.default.equal((stats.verificationFailures24h ?? 0) >= 0, true);
});
(0, node_test_1.default)("memory review actions retire stale workaround memory and resolve the review case", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.ok(reviewCase);
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
    strict_1.default.equal(actionResult.reviewCase?.status, "resolved");
    strict_1.default.equal(updated.status, "archived");
    strict_1.default.equal(updated.lattice?.operationalStatus, "retired");
    strict_1.default.equal(updated.lattice?.reviewAction, "none");
    strict_1.default.equal((updated.evidence?.length ?? 0) >= 1, true);
    strict_1.default.equal((updated.transitions?.length ?? 0) >= 1, true);
    strict_1.default.equal(latestCase?.status, "resolved");
    strict_1.default.equal(verificationRuns.some((row) => row.resultStatus === "passed"), true);
});
(0, node_test_1.default)("memory consolidation writes explainable artifacts and relationship repairs", { concurrency: false }, async () => {
    const adapter = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
        store: adapter,
        defaultTenantId: "tenant-consolidation",
        defaultAgentId: "agent:codex",
        defaultRunId: "run-consolidation",
    });
    const artifactPath = memoryConsolidationArtifactPath();
    (0, node_fs_1.rmSync)(artifactPath, { force: true });
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
        strict_1.default.equal(result.promotionCount, 1);
        strict_1.default.equal(result.archiveCount, 1);
        strict_1.default.equal(result.softClusterCount, 1);
        strict_1.default.equal(result.connectionNoteCount, 1);
        strict_1.default.equal(Array.isArray(result.repairDetails), true);
        strict_1.default.equal(Array.isArray(result.promotionDetails), true);
        strict_1.default.equal(Array.isArray(result.connectionNoteDetails), true);
        strict_1.default.equal(Array.isArray(result.writeAudit), true);
        strict_1.default.equal(Array.isArray(result.phaseAudit), true);
        strict_1.default.equal(Array.isArray(result.decisionAudit), true);
        strict_1.default.equal((result.writeAudit ?? []).some((entry) => entry.action === "promotion" && entry.writeKind === "memory-record"), true);
        strict_1.default.equal((result.writeAudit ?? []).some((entry) => entry.action === "archive" && entry.phase === "promotionEvaluation"), true);
        strict_1.default.equal((result.decisionAudit ?? []).some((entry) => entry.decision === "promotion" && (entry.status === "promoted" || entry.status === "skipped")), true);
        strict_1.default.equal((result.phaseAudit ?? []).some((entry) => entry.phase === "candidateSelection" && entry.event === "complete"), true);
        strict_1.default.equal(result.repairDetails?.[0]?.clusterKey != null, true);
        strict_1.default.equal(result.promotionDetails?.[0]?.status, "promoted");
        strict_1.default.equal(result.connectionNoteDetails?.[0]?.topic != null, true);
        strict_1.default.equal(result.actionabilityStatus, "passed");
        strict_1.default.equal(Number(result.actionableInsightCount ?? 0) >= 1, true);
        strict_1.default.equal(Number(result.topActions?.length ?? 0) >= 2, true);
        const rows = await service.getByIds({
            ids: [episodic.id, canonical.id],
            includeArchived: true,
        });
        strict_1.default.equal(rows.find((row) => row.id === episodic.id)?.status, "archived");
        strict_1.default.equal(rows.find((row) => row.id === canonical.id)?.status, "accepted");
        const promotedRows = await service.search({
            query: "kiln dashboard browser-first control tower stabilizes",
            layerAllowlist: ["canonical"],
        });
        strict_1.default.equal(promotedRows.some((row) => row.source === "memory-consolidation-promoted"), true);
        const connectionRows = await service.search({
            query: "Dream connection note kiln dashboard browser-first live control tower stabilizes",
            layerAllowlist: ["episodic"],
        });
        strict_1.default.equal(connectionRows.some((row) => row.source === "memory-consolidation-connection"), true);
        const signalPresence = await adapter.hasSignalIndex?.({
            tenantId: "tenant-consolidation",
            memoryId: canonical.id,
            edgeKeys: [{ targetId: episodic.id, relationType: "duplicate-of" }],
        });
        strict_1.default.equal(typeof signalPresence === "object" || signalPresence == null, true);
        strict_1.default.equal((0, node_fs_1.existsSync)(artifactPath), true);
        const artifact = JSON.parse((0, node_fs_1.readFileSync)(artifactPath, "utf8"));
        strict_1.default.match(String(artifact.summary || ""), /promoted 1, archived 1/i);
        strict_1.default.match(String(artifact.summary || ""), /wrote 1 connection notes?/i);
        strict_1.default.equal(artifact.softClusterCount, 1);
        strict_1.default.equal(artifact.connectionNoteCount, 1);
        strict_1.default.equal(Array.isArray(artifact.repairDetails), true);
        strict_1.default.equal(Array.isArray(artifact.connectionNoteDetails), true);
        strict_1.default.equal(Array.isArray(artifact.writeAudit), true);
        strict_1.default.equal(Array.isArray(artifact.phaseAudit), true);
        strict_1.default.equal(Array.isArray(artifact.decisionAudit), true);
        strict_1.default.equal(Number((artifact.writeAudit ?? []).length) >= 1, true);
    }
    finally {
        (0, node_fs_1.rmSync)(artifactPath, { force: true });
    }
});
(0, node_test_1.default)("memory consolidation widens beyond the freshest rows to recover older related memories", { concurrency: false }, async () => {
    const adapter = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
        store: adapter,
        defaultTenantId: "tenant-wide-dream",
        defaultAgentId: "agent:codex",
        defaultRunId: "run-wide-dream",
    });
    const artifactPath = memoryConsolidationArtifactPath();
    (0, node_fs_1.rmSync)(artifactPath, { force: true });
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
        strict_1.default.equal(result.promotionCount, 1);
        strict_1.default.equal(result.archiveCount, 1);
        strict_1.default.equal(result.connectionNoteCount, 1);
        strict_1.default.equal(Number(result.candidateSelectionDetails?.recentCreatedCount ?? 0), 2);
        strict_1.default.equal(Number(result.candidateSelectionDetails?.queryExpansionCount ?? 0) >= 2, true);
        strict_1.default.equal(Number(result.candidateSelectionDetails?.uniqueCandidateCount ?? 0) > 2, true);
        strict_1.default.equal(Array.isArray(result.candidateSelectionDetails?.byFamily), true);
        const artifact = JSON.parse((0, node_fs_1.readFileSync)(artifactPath, "utf8"));
        strict_1.default.equal(Number(artifact.connectionNoteCount ?? 0), 1);
        strict_1.default.equal(Array.isArray(artifact.candidateSelectionDetails?.querySeeds), true);
        strict_1.default.equal(Number(artifact.candidateSelectionDetails?.queryExpansionCount ?? 0) >= 2, true);
    }
    finally {
        (0, node_fs_1.rmSync)(artifactPath, { force: true });
    }
});
(0, node_test_1.default)("memory consolidation uses association intents for themed bundles", { concurrency: false }, async () => {
    const adapter = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
        store: adapter,
        defaultTenantId: "tenant-association-intents",
        defaultAgentId: "agent:codex",
        defaultRunId: "run-association-intents",
        associationScout: {
            async scout(bundle) {
                if (bundle.bundleType !== "theme-cluster")
                    return null;
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
    (0, node_fs_1.rmSync)(artifactPath, { force: true });
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
        strict_1.default.equal(result.archiveCount, 0);
        strict_1.default.equal(result.connectionNoteCount, 1);
        strict_1.default.equal(Number(result.associationBundleCount ?? 0) >= 1, true);
        strict_1.default.equal(Number(result.associationIntentCount ?? 0) >= 2, true);
        const connectionRows = await service.search({
            query: "approval summary before action synthesized note operator habit runbook fragment",
            layerAllowlist: ["episodic"],
        });
        const intentRow = connectionRows.find((row) => row.source === "memory-consolidation-connection");
        strict_1.default.equal(Boolean(intentRow), true);
        strict_1.default.equal(intentRow?.metadata?.associationScout?.provider, "test.stub");
        const artifact = JSON.parse((0, node_fs_1.readFileSync)(artifactPath, "utf8"));
        strict_1.default.equal(Number(artifact.associationBundleCount ?? 0) >= 1, true);
        strict_1.default.equal(Number(artifact.associationIntentCount ?? 0) >= 2, true);
        strict_1.default.equal(Array.isArray(artifact.associationDetails), true);
        strict_1.default.equal(Number(artifact.themeClusterCount ?? 0) >= 1, true);
        strict_1.default.equal(Array.isArray(artifact.writeAudit), true);
        strict_1.default.equal(Array.isArray(artifact.decisionAudit), true);
        strict_1.default.equal((artifact.writeAudit ?? []).some((entry) => entry.action === "connection-note" && entry.phase === "associationScout"), true);
        strict_1.default.equal((artifact.decisionAudit ?? []).some((entry) => entry.decision === "bundle-evaluated" && entry.phase === "associationScout"), true);
    }
    finally {
        (0, node_fs_1.rmSync)(artifactPath, { force: true });
    }
});
(0, node_test_1.default)("memory consolidation source balancing caps raw compaction share when other families are available", { concurrency: false }, async () => {
    const adapter = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
        store: adapter,
        defaultTenantId: "tenant-source-balance",
        defaultAgentId: "agent:codex",
        defaultRunId: "run-source-balance",
    });
    const artifactPath = memoryConsolidationArtifactPath();
    (0, node_fs_1.rmSync)(artifactPath, { force: true });
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
        const selection = result.candidateSelectionDetails;
        const actual = selection.familyQuotaActual || [];
        const rawEntry = actual.find((entry) => entry.family === "compaction-raw");
        const rawSelected = Number(rawEntry?.selectedCount ?? 0);
        const totalSelected = Number(selection.postBalanceCandidateCount ?? 0);
        strict_1.default.equal(totalSelected > 0, true);
        strict_1.default.equal(rawSelected / totalSelected <= 0.2, true);
        strict_1.default.equal((selection.dominanceWarnings ?? []).some((entry) => /compaction-raw/i.test(entry)), false);
    }
    finally {
        (0, node_fs_1.rmSync)(artifactPath, { force: true });
    }
});
(0, node_test_1.default)("memory consolidation confirms associative promotion candidates on the second pass", { concurrency: false }, async () => {
    const adapter = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
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
    (0, node_fs_1.rmSync)(artifactPath, { force: true });
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
        strict_1.default.equal(canonicalResults.some((row) => row.source === "memory-consolidation-promoted"), true);
        strict_1.default.equal(Number(result.synthesisBundleCount ?? 0) >= 1, true);
        strict_1.default.equal(Number(result.secondPassQueriesUsed ?? 0) >= 1, true);
        strict_1.default.equal(Number(result.promotionCandidateConfirmedCount ?? 0) >= 1, true);
        const artifact = JSON.parse((0, node_fs_1.readFileSync)(artifactPath, "utf8"));
        strict_1.default.equal(Number(artifact.synthesisBundleCount ?? 0) >= 1, true);
        strict_1.default.equal(Array.isArray(artifact.queryReplayDetails), true);
        strict_1.default.equal(Number(artifact.promotionCandidateConfirmedCount ?? 0) >= 1, true);
        strict_1.default.equal((artifact.promotionCandidateDetails ?? []).some((entry) => entry.status === "confirmed"), true);
    }
    finally {
        (0, node_fs_1.rmSync)(artifactPath, { force: true });
    }
});
(0, node_test_1.default)("memory search and context exclude dream promotion candidates by default", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(defaultSearch.some((row) => row.source === "memory-consolidation-promotion-candidate"), false);
    strict_1.default.equal(explicitSearch.some((row) => row.source === "memory-consolidation-promotion-candidate"), true);
    strict_1.default.equal((defaultContext.items ?? []).some((row) => row.source === "memory-consolidation-promotion-candidate"), false);
});
(0, node_test_1.default)("memory service does not default pseudo decision traces into accepted episodic memory", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "tenant-pseudo-decision",
        defaultAgentId: "agent:codex",
        defaultRunId: "run-pseudo-decision",
    });
    const trace = await service.capture({
        content: "Context loaded via fallback retrieval for startup query replay.",
        source: "codex",
        tags: ["decision"],
    });
    strict_1.default.equal(trace.status, "proposed");
});
(0, node_test_1.default)("memory consolidation suppresses pseudo decision traces from candidate selection and query seeds", { concurrency: false }, async () => {
    const adapter = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
        store: adapter,
        defaultTenantId: "tenant-pseudo-filter",
        defaultAgentId: "agent:codex",
        defaultRunId: "run-pseudo-filter",
    });
    const artifactPath = memoryConsolidationArtifactPath();
    (0, node_fs_1.rmSync)(artifactPath, { force: true });
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
        });
        strict_1.default.equal(Number(result.candidateSelectionDetails?.suppressedPseudoDecisionCount ?? 0) >= 1, true);
        strict_1.default.equal((result.candidateSelectionDetails?.querySeeds ?? []).some((entry) => String(entry).toLowerCase().includes("startup query")), false);
    }
    finally {
        (0, node_fs_1.rmSync)(artifactPath, { force: true });
    }
});
(0, node_test_1.default)("memory consolidation quarantines contradictory mail-thread merges and suppresses misleading connection notes", { concurrency: false }, async () => {
    const adapter = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
        store: adapter,
        defaultTenantId: "tenant-mail-quarantine",
        defaultAgentId: "agent:codex",
        defaultRunId: "run-mail-quarantine",
        associationScout: {
            async scout(bundle) {
                if (bundle.bundleType !== "theme-cluster")
                    return null;
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
    (0, node_fs_1.rmSync)(artifactPath, { force: true });
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
        });
        strict_1.default.equal(result.quarantineCount, 1);
        strict_1.default.equal(result.connectionNoteCount, 0);
        strict_1.default.equal(Number(result.suppressedConnectionNoteCount ?? 0) >= 1, true);
        strict_1.default.equal(result.actionabilityStatus, "passed");
        strict_1.default.equal(Number(result.topActions?.length ?? 0) >= 2, true);
    }
    finally {
        (0, node_fs_1.rmSync)(artifactPath, { force: true });
    }
});
(0, node_test_1.default)("memory consolidation suppresses unchanged connection notes on rerun", { concurrency: false }, async () => {
    const adapter = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
        store: adapter,
        defaultTenantId: "tenant-unchanged-connection-note",
        defaultAgentId: "agent:codex",
        defaultRunId: "run-unchanged-connection-note",
        associationScout: {
            async scout(bundle) {
                if (bundle.bundleType !== "theme-cluster")
                    return null;
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
    (0, node_fs_1.rmSync)(artifactPath, { force: true });
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
        });
        const second = await service.consolidate({
            mode: "idle",
            runId: "test-unchanged-connection-second",
            maxCandidates: 6,
            maxWrites: 8,
            timeBudgetMs: 30_000,
            focusAreas: ["approval summary before action"],
        });
        strict_1.default.equal(first.connectionNoteCount, 1);
        strict_1.default.equal(second.connectionNoteCount, 0);
        strict_1.default.equal(Number(second.suppressedConnectionNoteCount ?? 0) >= 1, true);
    }
    finally {
        (0, node_fs_1.rmSync)(artifactPath, { force: true });
    }
});
(0, node_test_1.default)("memory consolidation surfaces unavailable association scout status in the artifact", { concurrency: false }, async () => {
    const adapter = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
        store: adapter,
        defaultTenantId: "tenant-association-unavailable",
        defaultAgentId: "agent:codex",
        defaultRunId: "run-association-unavailable",
        associationScout: null,
    });
    const artifactPath = memoryConsolidationArtifactPath();
    (0, node_fs_1.rmSync)(artifactPath, { force: true });
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
        strict_1.default.equal(Number(result.themeClusterCount ?? 0) >= 1, true);
        strict_1.default.equal(Number(result.associationBundleCount ?? 0), 0);
        const artifact = JSON.parse((0, node_fs_1.readFileSync)(artifactPath, "utf8"));
        strict_1.default.equal(Number(artifact.themeClusterCount ?? 0) >= 1, true);
        strict_1.default.equal(artifact.associationScoutStatus?.available, false);
        strict_1.default.equal(artifact.associationScoutStatus?.reason, "disabled");
        strict_1.default.match(String(artifact.summary || ""), /association scout unavailable/i);
        strict_1.default.equal(Array.isArray(artifact.associationErrors), true);
        strict_1.default.match(String(artifact.associationErrors?.[0]?.error || ""), /association scout unavailable/i);
    }
    finally {
        (0, node_fs_1.rmSync)(artifactPath, { force: true });
    }
});
(0, node_test_1.default)("memory service importBatch reports failures when continueOnError=false", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "tenant-b",
    });
    const result = await service.importBatch({
        continueOnError: false,
        items: [{ content: "valid row" }, { content: "" }, { content: "unreached row" }],
    });
    strict_1.default.equal(result.imported, 1);
    strict_1.default.equal(result.failed, 1);
    strict_1.default.equal(result.results.length, 2);
    strict_1.default.equal(result.results[1]?.ok, false);
});
(0, node_test_1.default)("memory service importBatch preserves per-row source when no sourceOverride is supplied", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(rows[0]?.source, "repo-markdown");
    strict_1.default.equal(rows[1]?.source, "codex-resumable-session");
    strict_1.default.equal(rows[0]?.metadata.corpusRecordId, "fact-portal-1");
    strict_1.default.equal(rows[1]?.metadata.projectLane, "monsoonfire-portal");
});
(0, node_test_1.default)("memory service importBatch honors explicit sourceOverride when intentionally supplied", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(row?.source, "import");
});
(0, node_test_1.default)("repo markdown rows do not synthesize thread lineage without real thread evidence", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "tenant-thread-evidence",
    });
    const row = await service.capture({
        content: "Portal dashboard documentation notes and implementation outline.",
        source: "repo-markdown",
        metadata: {
            subject: "Portal dashboard docs",
        },
    });
    const metadata = (row.metadata ?? {});
    strict_1.default.equal(metadata.threadEvidence, "none");
    strict_1.default.equal(typeof metadata.threadKey, "undefined");
    strict_1.default.equal(Array.isArray(metadata.patternHints), true);
    strict_1.default.equal(metadata.patternHints.includes("structure:has-thread"), false);
});
(0, node_test_1.default)("mail-like rows retain derived thread evidence for relationship indexing", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    const metadata = (row.metadata ?? {});
    strict_1.default.equal(metadata.threadEvidence, "derived");
    strict_1.default.equal(typeof metadata.threadKey, "string");
    strict_1.default.notEqual(String(metadata.threadKey || "").length, 0);
});
(0, node_test_1.default)("synthetic thread metadata scrubber rewrites legacy non-threaded rows", async () => {
    const store = (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)();
    const service = (0, service_1.createMemoryService)({
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
    strict_1.default.equal(result.updated, 1);
    strict_1.default.equal(result.sample[0]?.beforeThreadKey, "mail-thread:unknown");
    strict_1.default.equal(result.sample[0]?.afterThreadKey, null);
    const [row] = await service.getByIds({
        ids: ["mem-legacy-thread-noise"],
        includeArchived: true,
    });
    const metadata = (row?.metadata ?? {});
    strict_1.default.equal(metadata.threadEvidence, "none");
    strict_1.default.equal(typeof metadata.threadKey, "undefined");
    strict_1.default.equal(typeof metadata.loopClusterKey, "undefined");
    strict_1.default.equal(typeof metadata.threadDeterministicSignature, "undefined");
    strict_1.default.equal(metadata.patternHints.includes("structure:has-thread"), false);
});
(0, node_test_1.default)("synthetic thread metadata scrubber leaves legitimate mail threading alone", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(result.eligible, 0);
    strict_1.default.equal(result.updated, 0);
});
(0, node_test_1.default)("memory nanny reroutes non-allowlisted tenant and derives stable namespace", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(row.tenantId, "monsoonfire-main");
    strict_1.default.equal(row.agentId, "agent:discord");
    strict_1.default.equal(row.runId, "agent:discord:main");
    const nanny = (row.metadata._memoryNanny ?? {});
    strict_1.default.equal(nanny.tenantFallbackApplied, true);
    strict_1.default.equal(nanny.requestedTenantId, "random-agent-space");
    strict_1.default.equal(nanny.resolvedTenantId, "monsoonfire-main");
});
(0, node_test_1.default)("memory nanny suppresses fast duplicate loops without client request ids", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(first.id.startsWith("mem_"), true);
    strict_1.default.equal(second.id.startsWith("mem_loop_"), true);
    const stats = await service.stats({});
    strict_1.default.equal(stats.total, 2);
});
(0, node_test_1.default)("context packs are budgeted and scoped for startup", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.ok(context.items.length >= 1);
    strict_1.default.equal(context.selection.agentId, "agent:codex");
    strict_1.default.equal(context.selection.runId, "agent:codex:main");
    strict_1.default.ok(context.budget.usedChars <= 512);
    strict_1.default.ok(context.items.every((row) => row.agentId === "agent:codex"));
});
(0, node_test_1.default)("context can expand memory relationships across linked rows", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(context.items.length >= 2, true);
    strict_1.default.ok(context.selection.expandRelationships);
    strict_1.default.equal(context.selection.relationshipExpansion.addedFromRelationships >= 1, true);
    strict_1.default.ok(context.selection.relationshipExpansion.attempted);
});
(0, node_test_1.default)("context can force a seed memory id before scoring", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(context.selection.seedMemoryId, "mem-seed");
    strict_1.default.equal(context.items[0]?.id, "mem-seed");
});
(0, node_test_1.default)("project-scoped queries boost same-lane corpus-backed rows over mail noise", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(rows[0]?.id, "mem-portal");
    strict_1.default.equal(rows[2]?.id, "mem-mail");
});
(0, node_test_1.default)("context prefers the explicit repo lane even when the query also mentions Studio Brain", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(repoBackedItems[0]?.id, "mem-portal");
});
(0, node_test_1.default)("compaction-promoted memories outrank raw compaction captures for startup-style queries", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(rows[0]?.id, "mem-promoted");
    strict_1.default.equal(rows[1]?.id, "mem-raw");
});
(0, node_test_1.default)("expired compaction raw rows are excluded from search and context selection", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
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
    strict_1.default.equal(searchRows.some((row) => row.id === "mem-expired-raw"), false);
    strict_1.default.equal(searchRows.some((row) => row.id === "mem-live-promoted"), true);
    const context = await service.context({
        agentId: "agent:codex",
        runId: "codex-thread:expired",
        query: "portal context bootstrap memory",
        maxItems: 5,
        maxChars: 1200,
        scanLimit: 50,
        includeTenantFallback: false,
    });
    strict_1.default.equal(context.items.some((row) => row.id === "mem-expired-raw"), false);
    strict_1.default.equal(context.items.some((row) => row.id === "mem-live-promoted"), true);
});
(0, node_test_1.default)("incident action idempotency replays when occurredAt is omitted", async () => {
    const service = (0, service_1.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "tenant-incident-idempotency",
    });
    const first = await service.incidentAction({
        loopKey: "loop.audit.idempotency",
        action: "ack",
        idempotencyKey: "incident-idem-001",
        note: "same payload",
    });
    strict_1.default.equal(first.ok, true);
    strict_1.default.equal(first.idempotency.replayed, false);
    strict_1.default.ok(first.feedback);
    strict_1.default.equal(first.feedback.counts.ackCount, 1);
    const replay = await service.incidentAction({
        loopKey: "loop.audit.idempotency",
        action: "ack",
        idempotencyKey: "incident-idem-001",
        note: "same payload",
    });
    strict_1.default.equal(replay.ok, true);
    strict_1.default.equal(replay.idempotency.replayed, true);
    strict_1.default.equal(replay.recordedAt, first.recordedAt);
    strict_1.default.ok(replay.feedback);
    strict_1.default.equal(replay.feedback.counts.ackCount, 1);
});
