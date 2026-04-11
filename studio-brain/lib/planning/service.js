"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanningService = exports.PlanningNotFoundError = exports.PlanningValidationError = void 0;
const hash_1 = require("../stores/hash");
const contracts_1 = require("./contracts");
const governance_1 = require("./governance");
const store_1 = require("./store");
class PlanningValidationError extends Error {
}
exports.PlanningValidationError = PlanningValidationError;
class PlanningNotFoundError extends Error {
}
exports.PlanningNotFoundError = PlanningNotFoundError;
function toTrimmedString(value) {
    return typeof value === "string" ? value.trim() : "";
}
function toStringList(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .map((entry) => toTrimmedString(entry))
        .filter(Boolean);
}
function setIntersection(values) {
    if (!values.length)
        return [];
    return [...new Set(values[0] ?? [])].filter((entry) => values.every((list) => list.includes(entry)));
}
function uniqueList(value) {
    return [...new Set(value.filter(Boolean))];
}
function summarizeText(value, maxLength = 240) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength)
        return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
function tokenize(value) {
    return value
        .toLowerCase()
        .split(/[^a-z0-9._/-]+/g)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length >= 3)
        .slice(0, 64);
}
function toRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
function shortHash(value, length = 24) {
    return (0, hash_1.stableHashDeep)(value).slice(0, Math.max(8, Math.min(length, 64)));
}
function parseWrapperIntegrity(value) {
    const record = toRecord(value);
    return {
        requestId: toTrimmedString(record.requestId),
        draftFingerprint: toTrimmedString(record.draftFingerprint),
        preparedRunId: toTrimmedString(record.preparedRunId),
        submittedObjective: toTrimmedString(record.submittedObjective || record.objective),
        submittedSourceType: toTrimmedString(record.submittedSourceType || record.sourceType),
        reportCorrelationId: toTrimmedString(record.reportCorrelationId),
        canaryGate: toTrimmedString(record.canaryGate),
    };
}
function buildRequestWrapperIntegrity(request) {
    const fromRequest = parseWrapperIntegrity(request.metadata);
    const requestId = fromRequest.requestId
        || `planning_req_${shortHash({
            request: request.request,
            docket: request.docket,
            sourceType: request.sourceType,
            requestedBy: request.requestedBy,
            draftPlan: request.draftPlan,
        }, 18)}`;
    const draftFingerprint = fromRequest.draftFingerprint
        || shortHash(typeof request.draftPlan === "string"
            ? request.draftPlan
            : {
                draftPlan: request.draftPlan,
                request: request.request,
                docket: request.docket,
                sourceType: request.sourceType,
            }, 24);
    const submittedObjective = fromRequest.submittedObjective
        || toTrimmedString(request.docket.objective)
        || toTrimmedString(request.request);
    const submittedSourceType = fromRequest.submittedSourceType
        || toTrimmedString(request.sourceType)
        || "raw-request";
    const preparedRunId = fromRequest.preparedRunId || toTrimmedString(request.preparedRunId);
    const reportCorrelationId = fromRequest.reportCorrelationId
        || `planning_report_${shortHash({ requestId, preparedRunId, draftFingerprint }, 16)}`;
    return {
        requestId,
        draftFingerprint,
        preparedRunId,
        submittedObjective,
        submittedSourceType,
        reportCorrelationId,
        canaryGate: fromRequest.canaryGate || "pending",
    };
}
function buildPreparationWrapperIntegrity(request, preparation) {
    const requestIntegrity = buildRequestWrapperIntegrity(request);
    const draftFingerprint = shortHash(preparation.canonicalDraftMarkdown || preparation.docket.objective, 24);
    return {
        requestId: requestIntegrity.requestId,
        draftFingerprint,
        preparedRunId: preparation.preparedRunId,
        submittedObjective: requestIntegrity.submittedObjective || toTrimmedString(preparation.docket.objective),
        submittedSourceType: requestIntegrity.submittedSourceType || toTrimmedString(preparation.docket.sourceType),
        reportCorrelationId: requestIntegrity.reportCorrelationId
            || `planning_report_${shortHash({ requestId: requestIntegrity.requestId, preparedRunId: preparation.preparedRunId, draftFingerprint }, 16)}`,
        canaryGate: "prepared",
    };
}
function buildBundleWrapperIntegrity(request, bundle) {
    const requestIntegrity = buildRequestWrapperIntegrity(request);
    const draftFingerprint = requestIntegrity.draftFingerprint
        || shortHash(bundle.packet.upgradedPlanMarkdown || bundle.packet.objective || bundle.docket.objective, 24);
    return {
        requestId: requestIntegrity.requestId,
        draftFingerprint,
        preparedRunId: requestIntegrity.preparedRunId || toTrimmedString(bundle.council.councilId),
        submittedObjective: requestIntegrity.submittedObjective || toTrimmedString(bundle.packet.objective || bundle.docket.objective),
        submittedSourceType: requestIntegrity.submittedSourceType || toTrimmedString(bundle.docket.sourceType),
        reportCorrelationId: requestIntegrity.reportCorrelationId
            || `planning_report_${shortHash({
                requestId: requestIntegrity.requestId,
                preparedRunId: requestIntegrity.preparedRunId || bundle.council.councilId,
                draftFingerprint,
            }, 16)}`,
        canaryGate: "pending",
    };
}
function buildExpectedCompletionIntegrity(preparation) {
    const fromPreparation = parseWrapperIntegrity(preparation.docket.metadata);
    return {
        requestId: fromPreparation.requestId
            || `planning_req_${shortHash({
                objective: preparation.docket.objective,
                requestedBy: preparation.docket.requestedBy,
                preparedRunId: preparation.preparedRunId,
            }, 18)}`,
        draftFingerprint: fromPreparation.draftFingerprint
            || shortHash(preparation.canonicalDraftMarkdown || preparation.docket.objective, 24),
        preparedRunId: fromPreparation.preparedRunId || preparation.preparedRunId,
        submittedObjective: fromPreparation.submittedObjective || toTrimmedString(preparation.docket.objective),
        submittedSourceType: fromPreparation.submittedSourceType || toTrimmedString(preparation.docket.sourceType),
        reportCorrelationId: fromPreparation.reportCorrelationId
            || `planning_report_${shortHash({
                requestId: fromPreparation.requestId || preparation.preparedRunId,
                preparedRunId: preparation.preparedRunId,
                draftFingerprint: fromPreparation.draftFingerprint || preparation.canonicalDraftMarkdown,
            }, 16)}`,
        canaryGate: fromPreparation.canaryGate || "prepared",
    };
}
function diffWrapperIntegrity(expected, actual, label) {
    const issues = [];
    const comparisons = [
        ["requestId", "requestId"],
        ["draftFingerprint", "draftFingerprint"],
        ["preparedRunId", "preparedRunId"],
        ["submittedObjective", "submittedObjective"],
    ];
    for (const [key, field] of comparisons) {
        if (expected[key] && actual[key] && expected[key] !== actual[key]) {
            issues.push(`${label} ${field} mismatch (${actual[key]} !== ${expected[key]})`);
        }
    }
    return issues;
}
function attachWrapperIntegrityToPreparation(preparation, integrity) {
    const next = preparation;
    next.docket = {
        ...preparation.docket,
        metadata: {
            ...toRecord(preparation.docket.metadata),
            ...integrity,
        },
    };
    next.swarmRun = {
        ...preparation.swarmRun,
        requestId: integrity.requestId,
        draftFingerprint: integrity.draftFingerprint,
        preparedRunId: integrity.preparedRunId,
        reportCorrelationId: integrity.reportCorrelationId,
        submittedObjective: integrity.submittedObjective,
        canaryGate: integrity.canaryGate,
    };
    next.wrapperIntegrity = integrity;
    return next;
}
function attachWrapperIntegrityToBundle(bundle, integrity) {
    const next = bundle;
    next.swarmRun = {
        ...bundle.swarmRun,
        requestId: integrity.requestId,
        draftFingerprint: integrity.draftFingerprint,
        preparedRunId: integrity.preparedRunId,
        reportCorrelationId: integrity.reportCorrelationId,
        submittedObjective: integrity.submittedObjective,
        canaryGate: integrity.canaryGate,
    };
    next.council = {
        ...bundle.council,
        wrapperIntegrity: integrity,
    };
    next.packet = {
        ...bundle.packet,
        preparedRunId: integrity.preparedRunId || toTrimmedString(bundle.packet.preparedRunId),
        wrapperIntegrity: {
            ...parseWrapperIntegrity(bundle.packet.wrapperIntegrity),
            ...integrity,
        },
    };
    next.wrapperIntegrity = integrity;
    return next;
}
function assertCompletionIntegrity(preparation, request) {
    const expected = buildExpectedCompletionIntegrity(preparation);
    const requestIntegrity = parseWrapperIntegrity(request.metadata);
    const external = toRecord(request.externalSwarmArtifacts);
    const controlPlaneIntegrity = parseWrapperIntegrity(external.controlPlane);
    const swarmRunIntegrity = parseWrapperIntegrity(external.swarmRun);
    const issues = [
        ...diffWrapperIntegrity(expected, requestIntegrity, "request metadata"),
        ...diffWrapperIntegrity(expected, controlPlaneIntegrity, "externalSwarmArtifacts.controlPlane"),
        ...diffWrapperIntegrity(expected, swarmRunIntegrity, "externalSwarmArtifacts.swarmRun"),
    ];
    if (issues.length > 0) {
        throw new PlanningValidationError(`Live swarm integrity gate failed: ${issues.join(" | ")}`);
    }
    return expected;
}
function hasExternalSwarmArtifacts(value) {
    const external = toRecord(value);
    if (toTrimmedString(external.finalDraftMarkdown))
        return true;
    if (Array.isArray(external.roleFindings) && external.roleFindings.length > 0)
        return true;
    if (Array.isArray(external.planRevisions) && external.planRevisions.length > 0)
        return true;
    if (Array.isArray(external.agentRuns) && external.agentRuns.length > 0)
        return true;
    if (Array.isArray(external.roundSummaries) && external.roundSummaries.length > 0)
        return true;
    if (Array.isArray(external.roleNotes) && external.roleNotes.length > 0)
        return true;
    if (Array.isArray(external.addressMatrix) && external.addressMatrix.length > 0)
        return true;
    return false;
}
function buildPlanningMemoryQuery(request) {
    const draftPlan = typeof request.draftPlan === "string"
        ? request.draftPlan
        : request.draftPlan && typeof request.draftPlan === "object"
            ? JSON.stringify(request.draftPlan)
            : "";
    return [
        request.request,
        request.docket.objective,
        request.docket.whyNow,
        ...request.docket.humanPriorities,
        ...request.docket.affectedSystems,
        draftPlan,
    ]
        .filter((entry) => Boolean(entry && entry.trim()))
        .join("\n")
        .slice(0, 1800);
}
function uniquePacketsById(packets) {
    const seen = new Set();
    const ordered = [];
    for (const packet of packets) {
        if (!packet?.packetId || seen.has(packet.packetId))
            continue;
        seen.add(packet.packetId);
        ordered.push(packet);
    }
    return ordered;
}
function requestMemoryPolicyIncludesRoleNotes(bundle) {
    return String(bundle.packet.memoryPolicyMode ?? bundle.docket.memoryPolicyMode ?? "") === "detailed_role_notes";
}
function summarizePacket(packet) {
    const recommendedPlan = (packet.recommendedPlan ?? {});
    return {
        packetId: packet.packetId,
        docketId: packet.docketId,
        councilId: packet.councilId,
        status: packet.status,
        objective: packet.objective,
        goNoGoRecommendation: toTrimmedString(packet.goNoGoRecommendation ?? ""),
        confidence: toTrimmedString(packet.confidenceAssessment?.label ?? ""),
        requiredHumanDecisionCount: toStringList(packet.requiredHumanDecisions).length,
        validationGateCount: toStringList(packet.validationGates).length,
        failureModeCount: toStringList(packet.failureModes).length,
        dissentCount: toStringList(packet.dissent).length,
        optionCount: Array.isArray(recommendedPlan.optionsConsidered) ? recommendedPlan.optionsConsidered.length : 0,
    };
}
function buildFieldDifferences(packets) {
    const fields = [
        ["status", (packet) => packet.status],
        ["objective", (packet) => packet.objective],
        ["goNoGoRecommendation", (packet) => packet.goNoGoRecommendation ?? null],
        ["confidence", (packet) => packet.confidenceAssessment?.label ?? null],
        ["requiredHumanDecisionCount", (packet) => toStringList(packet.requiredHumanDecisions).length],
        ["validationGateCount", (packet) => toStringList(packet.validationGates).length],
        ["failureModeCount", (packet) => toStringList(packet.failureModes).length],
        ["dissentCount", (packet) => toStringList(packet.dissent).length],
    ];
    return fields
        .map(([field, getter]) => ({
        field,
        values: packets.map((packet) => ({ packetId: packet.packetId, value: getter(packet) })),
    }))
        .filter((entry) => {
        const values = entry.values.map((row) => (0, hash_1.stableHashDeep)(row.value));
        return new Set(values).size > 1;
    });
}
class PlanningService {
    store;
    eventStore;
    memoryService;
    repoRoot;
    now;
    governancePromise = null;
    roleLibrarySeedPromise = null;
    constructor(options = {}) {
        this.store = options.store ?? new store_1.PostgresPlanningStore();
        this.eventStore = options.eventStore ?? null;
        this.memoryService = options.memoryService ?? null;
        this.repoRoot = options.repoRoot ?? (0, governance_1.findPlanningRepoRoot)();
        this.now = options.now ?? (() => new Date().toISOString());
    }
    async getGovernanceBundle() {
        if (!this.governancePromise) {
            this.governancePromise = (async () => {
                const module = await (0, governance_1.loadPlanningControlPlaneModule)(this.repoRoot);
                const governance = module.loadPlanningGovernance(this.repoRoot);
                const validation = module.validatePlanningGovernance(this.repoRoot, governance);
                if (validation.status !== "pass") {
                    const findings = (validation.findings ?? [])
                        .slice(0, 6)
                        .map((finding) => toTrimmedString(finding.message))
                        .filter(Boolean);
                    throw new Error(`Planning governance validation failed: ${findings.join(" | ")}`);
                }
                return { repoRoot: this.repoRoot, governance, module };
            })();
        }
        return this.governancePromise;
    }
    async ensureRoleLibrarySeeded(now = this.now()) {
        if (!this.roleLibrarySeedPromise) {
            this.roleLibrarySeedPromise = (async () => {
                const { governance, module } = await this.getGovernanceBundle();
                const sourceSync = module.buildRoleSourceSync(governance, { now });
                const extractedCandidates = Array.isArray(sourceSync.extractedCandidates) ? sourceSync.extractedCandidates : [];
                const roleScoreReport = module.buildRoleScoreReport(governance, extractedCandidates, { now });
                const seed = {
                    sources: Array.isArray(sourceSync.sources) ? sourceSync.sources : [],
                    snapshots: Array.isArray(sourceSync.snapshots) ? sourceSync.snapshots : [],
                    candidates: extractedCandidates,
                    curatedRoles: Array.isArray(governance.curatedRoleManifests?.roles)
                        ? governance.curatedRoleManifests.roles
                        : [],
                    curatedScores: Array.isArray(roleScoreReport.curatedScores) ? roleScoreReport.curatedScores : [],
                    candidateScores: Array.isArray(roleScoreReport.candidateScores) ? roleScoreReport.candidateScores : [],
                };
                await this.store.seedRoleLibrary(seed);
            })();
        }
        await this.roleLibrarySeedPromise;
    }
    async appendAuditEvent(event) {
        if (!this.eventStore)
            return;
        await this.eventStore.append(event);
    }
    parseSubmitRequest(input) {
        const parsed = contracts_1.planningSubmitRequestSchema.safeParse(input);
        if (!parsed.success) {
            throw new PlanningValidationError(parsed.error.issues[0]?.message ?? "Invalid planning submit payload.");
        }
        return parsed.data;
    }
    async buildPriorPacketContext(request) {
        const requestedPackets = request.priorPacketIds.length > 0 ? await this.store.getPackets(request.priorPacketIds) : [];
        if (request.memoryPolicy.includePriorPackets === false)
            return uniquePacketsById(requestedPackets);
        const recentPackets = await this.store.listPackets(12);
        const queryTokens = tokenize(buildPlanningMemoryQuery(request));
        const ranked = recentPackets
            .map((packet) => {
            const haystack = `${toTrimmedString(packet.objective)} ${toStringList(packet.failureModes).join(" ")} ${toStringList(packet.requiredHumanDecisions).join(" ")}`.toLowerCase();
            const score = queryTokens.reduce((acc, token) => acc + (haystack.includes(token) ? 1 : 0), 0);
            return { packet, score };
        })
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score || String(right.packet.createdAt ?? "").localeCompare(String(left.packet.createdAt ?? "")))
            .slice(0, 6)
            .map((entry) => entry.packet);
        return uniquePacketsById([...requestedPackets, ...ranked]);
    }
    async buildMemoryPack(request, now) {
        if (!this.memoryService) {
            return {
                status: "disabled",
                query: null,
                summary: "",
                refs: [],
                error: null,
            };
        }
        const query = buildPlanningMemoryQuery(request);
        if (!query) {
            return {
                status: "empty-query",
                query: null,
                summary: "",
                refs: [],
                error: null,
            };
        }
        try {
            const context = await this.memoryService.context({
                tenantId: request.tenantId,
                agentId: "planning-council",
                runId: `planning-council:${request.requestedBy}:${now}`,
                query,
                maxItems: Math.max(4, Math.min(request.memoryPolicy.maxSharedItems ?? 8, 16)),
                maxChars: 6000,
                scanLimit: 120,
                includeTenantFallback: true,
            });
            return {
                status: "available",
                query,
                summary: context.summary,
                refs: context.items.map((item) => ({
                    refId: item.id,
                    source: item.source,
                    summary: summarizeText(item.content, 220),
                    score: item.score,
                    matchedBy: item.matchedBy,
                    tags: item.tags,
                    metadata: item.metadata,
                })),
                diagnostics: context.diagnostics,
            };
        }
        catch (error) {
            return {
                status: "unavailable",
                query,
                summary: "",
                refs: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    async persistCouncilMemory(bundle) {
        if (!this.memoryService) {
            return { status: "disabled", imported: 0, refs: [] };
        }
        const mode = String(bundle.docket.memoryPolicyMode ?? bundle.packet.memoryPolicyMode ?? "detailed_role_notes");
        const writeback = bundle.packet.memoryWritebackEnabled !== false;
        if (!writeback || mode === "none") {
            return { status: "skipped", imported: 0, refs: [] };
        }
        const requiredHumanDecisions = toStringList(bundle.packet.requiredHumanDecisions);
        const topDissent = toStringList(bundle.packet.dissent).slice(0, 6);
        const roleNotes = Array.isArray(bundle.roleNotes) ? bundle.roleNotes : [];
        const addressMatrix = Array.isArray(bundle.addressMatrix) ? bundle.addressMatrix : [];
        const addressOutcomeSummary = {
            accepted: addressMatrix.filter((entry) => toTrimmedString(entry.status) === "accepted").length,
            partiallyAccepted: addressMatrix.filter((entry) => toTrimmedString(entry.status) === "partially_accepted").length,
            unresolved: addressMatrix.filter((entry) => toTrimmedString(entry.status) === "unresolved").length,
            rejected: addressMatrix.filter((entry) => toTrimmedString(entry.status) === "rejected").length,
        };
        const items = [
            {
                content: `Planning council upgraded plan for ${bundle.packet.objective}\n${String(bundle.packet.upgradedPlanMarkdown ?? bundle.synthesizedPlan.upgradedPlanMarkdown ?? "").trim()}`.trim(),
                tags: ["planning-council", "upgraded-plan"],
                metadata: {
                    councilId: bundle.packet.councilId,
                    packetId: bundle.packet.packetId,
                    kind: "upgraded-plan",
                    goNoGoRecommendation: bundle.packet.goNoGoRecommendation,
                },
                importance: 0.9,
                memoryType: "semantic",
            },
            {
                content: `Planning council decision for ${bundle.packet.objective}: ${String(bundle.packet.goNoGoRecommendation ?? "go_with_conditions")} because ${String(bundle.packet.goNoGoWhy ?? bundle.packet.why ?? "see packet rationale").trim()}`.trim(),
                tags: ["planning-council", "decision"],
                metadata: {
                    councilId: bundle.packet.councilId,
                    packetId: bundle.packet.packetId,
                    kind: "decision",
                },
                importance: 0.82,
                memoryType: "semantic",
            },
            {
                content: `Required human decisions for ${bundle.packet.objective}: ${requiredHumanDecisions.join(" | ") || "None."}`,
                tags: ["planning-council", "human-decisions"],
                metadata: {
                    councilId: bundle.packet.councilId,
                    packetId: bundle.packet.packetId,
                    kind: "required-human-decisions",
                },
                importance: 0.76,
                memoryType: "semantic",
            },
            {
                content: `Top objections and dissent for ${bundle.packet.objective}: ${topDissent.join(" | ") || "No material dissent recorded."}`,
                tags: ["planning-council", "dissent"],
                metadata: {
                    councilId: bundle.packet.councilId,
                    packetId: bundle.packet.packetId,
                    kind: "dissent-summary",
                },
                importance: 0.72,
                memoryType: "semantic",
            },
            {
                content: `Next recommended action for ${bundle.packet.objective}: ${toStringList(bundle.packet.orderedExecutionSequence)[0] ?? "Review the upgraded plan and decide whether to proceed."}`,
                tags: ["planning-council", "next-action"],
                metadata: {
                    councilId: bundle.packet.councilId,
                    packetId: bundle.packet.packetId,
                    kind: "next-action",
                },
                importance: 0.7,
                memoryType: "semantic",
            },
            {
                content: `Planner address outcomes for ${bundle.packet.objective}: accepted ${addressOutcomeSummary.accepted}, partially accepted ${addressOutcomeSummary.partiallyAccepted}, unresolved ${addressOutcomeSummary.unresolved}, rejected ${addressOutcomeSummary.rejected}.`,
                tags: ["planning-council", "address-outcomes"],
                metadata: {
                    councilId: bundle.packet.councilId,
                    packetId: bundle.packet.packetId,
                    kind: "planner-address-outcomes",
                    ...addressOutcomeSummary,
                },
                importance: 0.66,
                memoryType: "semantic",
            },
        ];
        if (mode === "detailed_role_notes" || requestMemoryPolicyIncludesRoleNotes(bundle)) {
            for (const roleNote of roleNotes) {
                items.push({
                    content: `Role summary from ${String(roleNote.roleName ?? roleNote.roleId)} during ${String(roleNote.roundType ?? "review")}: ${String(roleNote.summary ?? "").trim()}`.trim(),
                    tags: ["planning-council", "role-note", String(roleNote.roleId ?? "unknown-role")],
                    metadata: {
                        councilId: bundle.packet.councilId,
                        packetId: bundle.packet.packetId,
                        kind: "role-note",
                        roleId: roleNote.roleId,
                        roundType: roleNote.roundType,
                        stance: roleNote.stance,
                        proposedEdits: roleNote.proposedEdits,
                        objections: roleNote.objections,
                    },
                    importance: 0.64,
                    memoryType: "semantic",
                });
            }
        }
        try {
            const result = await this.memoryService.importBatch({
                sourceOverride: "planning-council",
                continueOnError: true,
                disableRunWriteBurstLimit: true,
                items: items.map((item) => ({
                    ...item,
                    tenantId: bundle.docket.tenantId,
                    agentId: "planning-council",
                    runId: String(bundle.swarmRun.runId ?? bundle.packet.councilId),
                    sourceConfidence: 0.82,
                })),
            });
            const refs = result.results
                .filter((entry) => entry.ok && entry.id)
                .map((entry, index) => ({
                refId: String(entry.id),
                scope: "writeback",
                kind: index < 5 ? "council-summary" : "role-note-summary",
            }));
            return {
                status: result.failed > 0 ? "partial" : "persisted",
                imported: result.imported,
                failed: result.failed,
                refs,
            };
        }
        catch (error) {
            return {
                status: "failed",
                imported: 0,
                refs: [],
                error: error instanceof Error ? error.message : String(error),
            };
        }
    }
    async finalizeBundle(request, bundle, memoryPack) {
        const { module } = await this.getGovernanceBundle();
        const memoryWriteback = await this.persistCouncilMemory(bundle);
        const writebackRefs = (Array.isArray(memoryWriteback.refs) ? memoryWriteback.refs : []);
        const mergedMemoryRefs = [...bundle.memoryRefs, ...writebackRefs];
        bundle.memoryRefs = mergedMemoryRefs.filter((ref, index) => {
            const hash = (0, hash_1.stableHashDeep)(ref);
            return mergedMemoryRefs.findIndex((candidate) => (0, hash_1.stableHashDeep)(candidate) === hash) === index;
        });
        bundle.swarmRun = {
            ...bundle.swarmRun,
            memoryPackStatus: toTrimmedString(memoryPack.status) || "missing",
            memoryWritebackStatus: memoryWriteback.status,
            memoryWritebackImported: memoryWriteback.imported ?? 0,
        };
        bundle.council = {
            ...bundle.council,
            swarmRun: bundle.swarmRun,
            agentRuns: bundle.agentRuns,
            roundSummaries: bundle.roundSummaries,
            memoryRefs: bundle.memoryRefs,
            roleFindings: bundle.roleFindings,
            roleNotes: bundle.roleNotes,
            planRevisions: bundle.planRevisions,
            addressMatrix: bundle.addressMatrix,
        };
        bundle.packet = module.embedPlanningPacketArtifacts({
            ...bundle.packet,
            memoryPolicyMode: request.memoryPolicy.mode,
            memoryWritebackEnabled: request.memoryPolicy.writeback,
            memoryWritebackStatus: memoryWriteback.status,
        }, {
            agentRuns: bundle.agentRuns,
            roundSummaries: bundle.roundSummaries,
            memoryRefs: bundle.memoryRefs,
            roleFindings: bundle.roleFindings,
            roleNotes: bundle.roleNotes,
            planRevisions: bundle.planRevisions,
            addressMatrix: bundle.addressMatrix,
        }, {
            packetArtifactLimits: toRecord(request.metadata).packetArtifactLimits,
        });
        await this.store.saveRun(bundle);
        await this.appendAuditEvent({
            actorType: "staff",
            actorId: request.requestedBy,
            action: "planning.packet.generated",
            rationale: `Generated planning packet for ${bundle.docket.objective}.`,
            target: "local",
            approvalState: "approved",
            inputHash: (0, hash_1.stableHashDeep)({
                request: request.request,
                docket: request.docket,
                sourceType: request.sourceType,
                requestedBy: request.requestedBy,
                submissionStage: request.submissionStage,
            }),
            outputHash: (0, hash_1.stableHashDeep)(bundle.packet),
            metadata: {
                packetId: bundle.packet.packetId,
                docketId: bundle.docket.docketId,
                councilId: bundle.council.councilId,
                stakes: bundle.fingerprint.stakes,
                touchpoints: bundle.fingerprint.touchpoints,
                requiredHumanDecisionCount: toStringList(bundle.packet.requiredHumanDecisions).length,
                reviewMode: request.reviewMode,
                swarmRunId: bundle.swarmRun.runId,
                memoryPackStatus: toTrimmedString(memoryPack.status) || "missing",
                memoryWritebackStatus: memoryWriteback.status,
            },
        });
        return bundle;
    }
    buildCompletionInput(preparation, request) {
        const immutableIntegrity = buildExpectedCompletionIntegrity(preparation);
        return {
            request: request.request || toTrimmedString(preparation.docket.rawRequest) || preparation.docket.objective,
            sourceType: toTrimmedString(preparation.docket.sourceType) || request.sourceType,
            reviewMode: request.reviewMode || toTrimmedString(preparation.docket.reviewMode) || "swarm",
            draftSource: request.draftSource || toTrimmedString(preparation.docket.draftSource) || "prompt_generated",
            requestedBy: request.requestedBy || preparation.docket.requestedBy,
            tenantId: request.tenantId || preparation.docket.tenantId,
            metadata: {
                ...toRecord(preparation.docket.metadata),
                ...toRecord(request.metadata),
                preparedRunId: preparation.preparedRunId,
                requestId: immutableIntegrity.requestId,
                draftFingerprint: immutableIntegrity.draftFingerprint,
                submittedObjective: immutableIntegrity.submittedObjective,
                submittedSourceType: immutableIntegrity.submittedSourceType,
                reportCorrelationId: immutableIntegrity.reportCorrelationId,
            },
            priorPacketIds: request.priorPacketIds.length > 0 ? request.priorPacketIds : toStringList(preparation.docket.priorPacketIds),
            swarmConfig: {
                ...toRecord(preparation.docket.swarmConfig),
                ...toRecord(request.swarmConfig),
                executionMode: toTrimmedString(request.swarmConfig.executionMode) || "live",
            },
            memoryPolicy: {
                ...toRecord(preparation.docket.memoryPolicy),
                ...toRecord(request.memoryPolicy),
            },
            docket: preparation.docket,
            ...(toTrimmedString(preparation.docket.sourceType) === "draft-plan"
                ? { draftPlan: preparation.canonicalDraftMarkdown }
                : {}),
            externalSwarmArtifacts: request.externalSwarmArtifacts,
        };
    }
    async prepare(input) {
        const request = this.parseSubmitRequest(input);
        const now = this.now();
        const { governance, module } = await this.getGovernanceBundle();
        await this.ensureRoleLibrarySeeded(now);
        const [priorPackets, memoryPack] = await Promise.all([
            this.buildPriorPacketContext(request),
            this.buildMemoryPack(request, now),
        ]);
        const preparation = module.buildPlanningPreparation(request, governance, {
            now,
            priorPackets,
            memoryPack,
        });
        const preparationIntegrity = buildPreparationWrapperIntegrity(request, preparation);
        const prepared = attachWrapperIntegrityToPreparation(preparation, preparationIntegrity);
        await this.store.savePreparation(prepared);
        await this.appendAuditEvent({
            actorType: "staff",
            actorId: request.requestedBy,
            action: "planning.swarm.prepared",
            rationale: `Prepared council swarm context for ${preparation.docket.objective}.`,
            target: "local",
            approvalState: "approved",
            inputHash: (0, hash_1.stableHashDeep)({
                request: request.request,
                docket: request.docket,
                sourceType: request.sourceType,
                requestedBy: request.requestedBy,
            }),
            outputHash: (0, hash_1.stableHashDeep)({
                preparedRunId: preparation.preparedRunId,
                councilId: preparation.council.councilId,
                swarmRunId: preparation.swarmRun.runId,
            }),
            metadata: {
                preparedRunId: prepared.preparedRunId,
                councilId: prepared.council.councilId,
                swarmRunId: prepared.swarmRun.runId,
                activeRoleCount: prepared.roleManifests.length,
                memoryPackStatus: toTrimmedString(prepared.sharedMemoryPack.status) || "missing",
                draftFingerprint: preparationIntegrity.draftFingerprint,
                requestId: preparationIntegrity.requestId,
            },
        });
        return prepared;
    }
    async complete(input) {
        const request = this.parseSubmitRequest(input);
        const preparedRunId = toTrimmedString(request.preparedRunId);
        if (!preparedRunId) {
            throw new PlanningValidationError("preparedRunId is required for submissionStage=complete.");
        }
        if (!hasExternalSwarmArtifacts(request.externalSwarmArtifacts)) {
            throw new PlanningValidationError("externalSwarmArtifacts with live role outputs are required for submissionStage=complete.");
        }
        const preparation = await this.store.getPreparation(preparedRunId);
        if (!preparation) {
            throw new PlanningNotFoundError(`Prepared planning run ${preparedRunId} was not found.`);
        }
        const expectedIntegrity = assertCompletionIntegrity(preparation, request);
        const buildNow = toTrimmedString(preparation.generatedAt) || toTrimmedString(preparation.docket.createdAt) || this.now();
        const { governance, module } = await this.getGovernanceBundle();
        await this.ensureRoleLibrarySeeded(buildNow);
        const completionInput = this.buildCompletionInput(preparation, request);
        const bundle = module.buildPlanningPacket(completionInput, governance, {
            now: buildNow,
            memoryPack: preparation.sharedMemoryPack,
            externalSwarmArtifacts: request.externalSwarmArtifacts,
        });
        if (expectedIntegrity.submittedObjective
            && toTrimmedString(bundle.packet.objective)
            && expectedIntegrity.submittedObjective !== toTrimmedString(bundle.packet.objective)) {
            throw new PlanningValidationError(`Completed planning packet objective diverged from the prepared request (${bundle.packet.objective} !== ${expectedIntegrity.submittedObjective}).`);
        }
        const finalizedRequest = {
            ...request,
            metadata: {
                ...toRecord(request.metadata),
                ...expectedIntegrity,
                canaryGate: "matched",
            },
        };
        const bundleWithIntegrity = attachWrapperIntegrityToBundle(bundle, {
            ...expectedIntegrity,
            canaryGate: "matched",
        });
        return this.finalizeBundle(finalizedRequest, bundleWithIntegrity, preparation.sharedMemoryPack);
    }
    async submit(input) {
        const request = this.parseSubmitRequest(input);
        if (request.submissionStage === "prepare") {
            throw new PlanningValidationError("submissionStage=prepare must be handled via PlanningService.prepare().");
        }
        if (request.submissionStage === "complete") {
            return this.complete(request);
        }
        const now = this.now();
        const { governance, module } = await this.getGovernanceBundle();
        await this.ensureRoleLibrarySeeded(now);
        const [priorPackets, memoryPack] = await Promise.all([
            this.buildPriorPacketContext(request),
            this.buildMemoryPack(request, now),
        ]);
        const bundle = module.buildPlanningPacket(request, governance, {
            now,
            priorPackets,
            memoryPack,
        });
        const bundleIntegrity = buildBundleWrapperIntegrity(request, bundle);
        const requestWithIntegrity = {
            ...request,
            metadata: {
                ...toRecord(request.metadata),
                ...bundleIntegrity,
                canaryGate: "matched",
            },
        };
        const bundleWithIntegrity = attachWrapperIntegrityToBundle(bundle, {
            ...bundleIntegrity,
            canaryGate: "matched",
        });
        return this.finalizeBundle(requestWithIntegrity, bundleWithIntegrity, memoryPack);
    }
    async getPacket(packetId) {
        const packet = await this.store.getPacket(packetId);
        if (!packet) {
            throw new PlanningNotFoundError(`Planning packet ${packetId} was not found.`);
        }
        return packet;
    }
    async listPackets(limit = 25) {
        return this.store.listPackets(Math.max(1, Math.min(limit, 200)));
    }
    async getCouncil(councilId) {
        const council = await this.store.getCouncil(councilId);
        if (!council) {
            throw new PlanningNotFoundError(`Planning council ${councilId} was not found.`);
        }
        return council;
    }
    async listRoleLibrary(limit = 50) {
        await this.ensureRoleLibrarySeeded();
        return this.store.listRoleManifests(Math.max(1, Math.min(limit, 200)));
    }
    async comparePackets(input) {
        const parsed = contracts_1.planningPacketCompareRequestSchema.safeParse(input);
        if (!parsed.success) {
            throw new PlanningValidationError(parsed.error.issues[0]?.message ?? "Invalid planning packet compare payload.");
        }
        const request = parsed.data;
        const packets = await this.store.getPackets(request.packetIds);
        const packetsById = new Map(packets.map((packet) => [packet.packetId, packet]));
        const missingPacketIds = request.packetIds.filter((packetId) => !packetsById.has(packetId));
        if (packets.length < 2) {
            throw new PlanningNotFoundError("At least two planning packets are required for comparison.");
        }
        const comparison = {
            comparedAt: this.now(),
            packetIds: request.packetIds,
            missingPacketIds,
            summaries: packets.map((packet) => summarizePacket(packet)),
            sharedSignals: {
                requiredHumanDecisions: setIntersection(packets.map((packet) => uniqueList(toStringList(packet.requiredHumanDecisions)))),
                validationGates: setIntersection(packets.map((packet) => uniqueList(toStringList(packet.validationGates)))),
                failureModes: setIntersection(packets.map((packet) => uniqueList(toStringList(packet.failureModes)))),
            },
            fieldDifferences: buildFieldDifferences(packets),
        };
        await this.appendAuditEvent({
            actorType: "staff",
            actorId: "planning-service",
            action: "planning.packet.compared",
            rationale: `Compared ${packets.length} planning packets for arbitration review.`,
            target: "local",
            approvalState: "approved",
            inputHash: (0, hash_1.stableHashDeep)(request.packetIds),
            outputHash: (0, hash_1.stableHashDeep)(comparison),
            metadata: {
                packetIds: request.packetIds,
                missingPacketIds,
            },
        });
        return comparison;
    }
}
exports.PlanningService = PlanningService;
