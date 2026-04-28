"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const server_1 = require("./server");
const model_1 = require("../kiln/domain/model");
const memoryStore_1 = require("../kiln/memoryStore");
const artifacts_1 = require("../kiln/services/artifacts");
const manualEvents_1 = require("../kiln/services/manualEvents");
const orchestration_1 = require("../kiln/services/orchestration");
const service_1 = require("../ops/service");
const store_1 = require("../ops/store");
const memoryStores_1 = require("../stores/memoryStores");
const runtime_1 = require("../capabilities/runtime");
const inMemoryAdapter_1 = require("../memory/inMemoryAdapter");
const service_2 = require("../memory/service");
const logger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};
function createMemoryArtifactStore() {
    const objects = new Map();
    return {
        async put(key, data) {
            objects.set(key, Buffer.from(data));
        },
        async get(key) {
            return objects.get(key) ?? null;
        },
        async list(prefix = "") {
            return [...objects.keys()].filter((entry) => entry.startsWith(prefix));
        },
        async healthcheck() {
            return { ok: true, latencyMs: 0 };
        },
    };
}
function readKilnFixture(name) {
    return (0, node_fs_1.readFileSync)((0, node_path_1.join)(__dirname, "..", "..", "src", "kiln", "adapters", "genesis-log", "fixtures", name));
}
function buildKiln(overrides = {}) {
    return {
        id: "kiln_test",
        displayName: "Studio Electric",
        manufacturer: "L&L / Bartlett",
        kilnModel: "eQ2827",
        controllerModel: "Genesis",
        controllerFamily: "bartlett_genesis",
        firmwareVersion: "2.1.4",
        serialNumber: "serial-1",
        macAddress: "AA:BB:CC:DD:EE:01",
        zoneCount: 3,
        thermocoupleType: "K",
        output4Role: "vent",
        wifiConfigured: true,
        notes: null,
        capabilitiesDetected: (0, model_1.defaultCapabilitySet)(),
        riskFlags: [],
        lastSeenAt: "2026-04-14T12:00:00.000Z",
        currentRunId: null,
        ...overrides,
    };
}
function buildIngestHeaders(secret, payload, timestampSeconds = Math.trunc(Date.now() / 1000)) {
    const raw = JSON.stringify(payload);
    const signature = node_crypto_1.default.createHmac("sha256", secret).update(`${timestampSeconds}.${raw}`).digest("hex");
    return {
        "content-type": "application/json",
        "x-memory-ingest-timestamp": `${timestampSeconds}`,
        "x-memory-ingest-signature": `v1=${signature}`,
    };
}
function buildOpsIngestHeaders(secret, payload, timestampSeconds = Math.trunc(Date.now() / 1000)) {
    const raw = JSON.stringify(payload);
    const signature = node_crypto_1.default.createHmac("sha256", secret).update(`${timestampSeconds}.${raw}`).digest("hex");
    return {
        "content-type": "application/json",
        "x-ops-ingest-timestamp": `${timestampSeconds}`,
        "x-ops-ingest-signature": `v1=${signature}`,
    };
}
async function withServer(options, run) {
    const stateStore = options.stateStore ?? new memoryStores_1.MemoryStateStore();
    const eventStore = options.eventStore ?? new memoryStores_1.MemoryEventStore();
    const capabilityRuntime = new runtime_1.CapabilityRuntime(runtime_1.defaultCapabilities, eventStore);
    const memoryService = options.memoryService ??
        (0, service_2.createMemoryService)({
            store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
            defaultTenantId: "monsoonfire-main",
            defaultAgentId: "test-agent",
            defaultRunId: "test-run",
        });
    const server = (0, server_1.startHttpServer)({
        host: "127.0.0.1",
        port: 0,
        logger,
        stateStore,
        eventStore,
        pgCheck: async () => ({ ok: true, latencyMs: 1 }),
        capabilityRuntime,
        memoryService,
        verifyFirebaseAuth: async (authorizationHeader) => {
            if (authorizationHeader === "Bearer test-staff") {
                return {
                    uid: "staff-test-uid",
                    isStaff: true,
                    roles: ["staff"],
                    portalRole: "staff",
                    opsRoles: ["support_ops", "kiln_lead"],
                    opsCapabilities: [
                        "surface:hands",
                        "surface:internet",
                        "members:view",
                        "members:create",
                        "members:edit_profile",
                        "members:edit_membership",
                        "members:edit_role",
                        "members:edit_billing",
                        "approvals:view",
                        "tasks:claim:any",
                        "tasks:escape",
                        "proof:submit",
                        "proof:accept",
                        "reservations:view",
                        "reservations:prepare",
                        "events:view",
                        "reports:view",
                        "overrides:request",
                    ],
                };
            }
            if (authorizationHeader === "Bearer test-admin") {
                return {
                    uid: "admin-test-uid",
                    isStaff: true,
                    roles: ["staff", "admin"],
                    portalRole: "admin",
                    opsRoles: ["owner"],
                    opsCapabilities: [
                        "surface:owner",
                        "surface:manager",
                        "surface:hands",
                        "surface:internet",
                        "surface:ceo",
                        "surface:forge",
                        "members:view",
                        "members:create",
                        "members:edit_profile",
                        "members:edit_membership",
                        "members:edit_role",
                        "members:edit_owner_role",
                        "members:edit_billing",
                        "approvals:view",
                        "approvals:manage",
                        "tasks:claim:any",
                        "tasks:escape",
                        "proof:submit",
                        "proof:accept",
                        "reservations:view",
                        "reservations:prepare",
                        "events:view",
                        "reports:view",
                        "lending:view",
                        "finance:view",
                        "finance:act",
                        "overrides:request",
                        "overrides:approve",
                        "identity:manage",
                        "strategy:ceo",
                        "forge:manage",
                    ],
                };
            }
            if (authorizationHeader === "Bearer test-member") {
                return {
                    uid: "member-test-uid",
                    isStaff: false,
                    roles: [],
                    portalRole: "member",
                    opsRoles: [],
                    opsCapabilities: [],
                };
            }
            throw new Error("Missing Authorization header.");
        },
        ...options,
    });
    await new Promise((resolve) => server.on("listening", () => resolve()));
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    try {
        await run(baseUrl);
    }
    finally {
        await new Promise((resolve, reject) => {
            server.close((error) => {
                if (error)
                    reject(error);
                else
                    resolve();
            });
        });
    }
}
function buildSampleOverseerRun(overrides = {}) {
    return {
        runId: "ovr_test_1",
        computedAt: "2026-03-30T10:00:00.000Z",
        overallStatus: "warning",
        runtimePosture: {
            hostHealth: { status: "ok", summary: "healthy", checkedAt: "2026-03-30T10:00:00.000Z", evidence: [] },
            schedulerHealth: { status: "ok", summary: "healthy", checkedAt: "2026-03-30T10:00:00.000Z", evidence: [] },
            backupFreshness: { status: "warning", summary: "stale", checkedAt: "2026-03-30T10:00:00.000Z", evidence: [] },
            heartbeatFreshness: { status: "ok", summary: "fresh", checkedAt: "2026-03-30T10:00:00.000Z", evidence: [] },
            authMintHealth: { status: "ok", summary: "fresh", checkedAt: "2026-03-30T10:00:00.000Z", evidence: [] },
            connectorCoverage: { status: "warning", summary: "2/2 healthy", checkedAt: "2026-03-30T10:00:00.000Z", evidence: [] },
        },
        signalGaps: [],
        productOpportunities: [],
        coordinationActions: [],
        createdProposalIds: [],
        delivery: {
            dedupeKey: "dedupe-1",
            changed: true,
            matchedRunId: null,
            discord: {
                enabled: true,
                shouldNotify: true,
                summary: "Overseer warning",
                lines: ["status=warning"],
                detailPath: "output/overseer/discord/latest.json",
                target: {
                    guildId: "guild-1",
                    channelId: "channel-1",
                    applicationId: "app-1",
                    configured: true,
                },
                mcp: {
                    serverName: "discord",
                    pluginId: "discord-studiobrain@micah-local",
                    setupDocPath: "docs/STUDIO_BRAIN_DISCORD_MODEL.md",
                },
                sourceOfTruth: {
                    model: "openclaw-discord",
                    primaryDocPath: "docs/STUDIO_BRAIN_DISCORD_MODEL.md",
                    upstreamDocsUrl: "https://docs.openclaw.ai/channels/discord",
                    inspirationSources: [
                        "https://github.com/barryyip0625/mcp-discord",
                        "https://github.com/wrathagom/ai-discord-bot",
                        "https://github.com/timoconnellaus/claude-code-discord-bot",
                    ],
                },
                ingest: {
                    enabled: true,
                    source: "discord",
                    endpointPath: "/api/memory/ingest",
                    guildId: "guild-1",
                    channelId: "channel-1",
                    clientRequestIdTemplate: "overseer-ovr_test_1-{discordMessageId}",
                },
                routing: {
                    dmScope: "main",
                    guildSessions: "per_channel",
                    threadSessions: "per_thread",
                    sessionKeyTemplates: {
                        dm: "agent:studio-brain:main",
                        guildChannel: "agent:studio-brain:discord:channel:{channelId}",
                        thread: "agent:studio-brain:discord:thread:{threadId}",
                    },
                    groupPolicy: "allowlist",
                    requireMention: true,
                    allowBots: "never",
                    responsePrefix: null,
                    allowlistedGuildIds: ["guild-1"],
                    allowlistedChannelIds: ["channel-1"],
                },
                threadBindings: {
                    enabled: true,
                    idleHours: 24,
                    maxAgeHours: 0,
                    replyChainFallback: true,
                },
                execApprovals: {
                    enabled: true,
                    mode: "external_writes_only",
                },
                commandContracts: {
                    bot: [{ command: "/overseer latest", description: "Show latest summary." }],
                    mcp: [{ command: "read_channel_messages", description: "Read channel context." }],
                },
                executionQueue: [],
                messageDraft: {
                    title: "Studio Brain Overseer warning",
                    body: "Body",
                },
            },
            cli: {
                summary: "Overseer warning",
                detailPath: "output/overseer/latest.json",
                hints: ["GET /api/overseer/latest"],
            },
        },
        ...overrides,
    };
}
function createControlTowerFixture() {
    const root = (0, node_fs_1.mkdtempSync)((0, node_path_1.join)((0, node_os_1.tmpdir)(), "studio-brain-control-tower-"));
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(root, "output", "ops-cockpit", "agents"), { recursive: true });
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(root, "output", "ops-cockpit", "agent-status"), { recursive: true });
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(root, "output", "ops-cockpit", "hosts"), { recursive: true });
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(root, "output", "stability"), { recursive: true });
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(root, "output", "overseer", "discord"), { recursive: true });
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(root, "output", "studio-brain", "memory-brief"), { recursive: true });
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(root, "output", "studio-brain", "memory-consolidation"), { recursive: true });
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(root, "output", "qa"), { recursive: true });
    (0, node_fs_1.mkdirSync)((0, node_path_1.join)(root, "output", "agent-runs", "run-background-1"), { recursive: true });
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(root, "output", "ops-cockpit", "agents", "sb-room.json"), `${JSON.stringify({
        sessionName: "sb-room",
        cwd: "/home/wuff/monsoonfire-portal",
        tool: "codex",
        group: "portal",
        room: "portal",
        summary: "Portal lane",
        objective: "Investigate portal issue and report the next safe move.",
    }, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(root, "output", "ops-cockpit", "hosts", "micah-laptop.json"), `${JSON.stringify({
        schema: "control-tower-host-heartbeat.v1",
        hostId: "micah-laptop",
        label: "Micah Laptop",
        environment: "local",
        role: "operator-laptop",
        health: "healthy",
        lastSeenAt: "2026-03-30T10:04:00.000Z",
        currentRunId: "run-background-1",
        agentCount: 1,
        version: "dev",
        metrics: {
            cpuPct: 24,
            memoryPct: 48,
            load1: 0.62,
        },
    }, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(root, "output", "stability", "heartbeat-summary.json"), `${JSON.stringify({ status: "pass", checkedAt: "2026-03-30T10:00:00.000Z" }, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(root, "output", "studio-brain", "memory-brief", "latest.json"), `${JSON.stringify({
        schema: "studio-brain.memory-brief.v1",
        generatedAt: "2026-03-30T10:00:00.000Z",
        continuityState: "ready",
        summary: "Portal continuity is loaded and ready for the next safe move.",
        goal: "Investigate portal issue and report the next safe move.",
        blockers: ["Operator review is still pending."],
        recentDecisions: ["Portal room stayed attached to the operator board."],
        recommendedNextActions: ["Inspect portal lane"],
        fallbackSources: ["output/ops-cockpit/operator-state.json"],
        sourcePath: "output/studio-brain/memory-brief/latest.json",
        layers: {
            coreBlocks: ["Investigate portal issue and report the next safe move."],
            workingMemory: ["Portal room waiting for a nudge."],
            episodicMemory: ["Portal room stayed attached to the operator board."],
            canonicalMemory: ["accepted corpus artifacts", "promoted JSONL", "SQLite materialization"],
        },
        consolidation: {
            mode: "scheduled",
            summary: "Offline consolidation is queued to dedupe overlap and strengthen memory links during the next quiet window.",
            lastRunAt: "2026-03-30T03:00:00.000Z",
            nextRunAt: "2026-03-31T03:00:00.000Z",
            focusAreas: ["Portal continuity", "Recent operator handoffs"],
            maintenanceActions: ["Dedupe overlap", "Refresh incident-to-artifact links"],
            outputs: [
                "output/studio-brain/memory-brief/latest.json",
                "output/memory/<overnight-run>/overnight-status.json",
            ],
            actionabilityStatus: "repair",
            actionableInsightCount: 0,
            suppressedConnectionNoteCount: 0,
            suppressedPseudoDecisionCount: 0,
            topActions: ["Inspect portal lane"],
        },
    }, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(root, "output", "studio-brain", "memory-consolidation", "latest.json"), `${JSON.stringify({
        schema: "studio-brain.memory-consolidation.v1",
        mode: "overnight",
        status: "success",
        summary: "Dream rescue pass succeeded for the portal continuity lane.",
        finishedAt: "2026-03-30T04:00:00.000Z",
        nextRunAt: "2026-03-31T04:00:00.000Z",
        promotionCount: 1,
        quarantineCount: 1,
        repairedEdgeCount: 6,
        actionabilityStatus: "passed",
        actionableInsightCount: 2,
        suppressedConnectionNoteCount: 3,
        suppressedPseudoDecisionCount: 2,
        topActions: [
            "Reuse the promoted approval summary memory as the canonical startup thread.",
            "Review and split the unknown mail-thread cluster before the next dream pass.",
        ],
        focusAreas: ["Portal continuity", "Approval summary before action"],
        outputs: [
            "output/studio-brain/memory-brief/latest.json",
            "output/studio-brain/memory-consolidation/latest.json",
        ],
    }, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(root, "output", "qa", "codex-startup-scorecard.json"), `${JSON.stringify({
        schema: "codex-startup-scorecard.v1",
        generatedAtIso: "2026-03-30T10:05:00.000Z",
        latest: {
            sample: {
                status: "pass",
                reasonCode: "ok",
                continuityState: "ready",
                latencyMs: 420,
            },
        },
        metrics: {
            readyRate: 0.98,
            groundingReadyRate: 0.97,
            blockedContinuityRate: 0.01,
            p95LatencyMs: 950,
        },
        supportingSignals: {
            toolcalls: {
                startupEntries: 7,
                startupFailures: 0,
                startupFailureRate: 0,
                groundingObservedEntries: 6,
                groundingLineComplianceRate: 1,
                preStartupRepoReadObservedEntries: 6,
                averagePreStartupRepoReads: 0,
                preStartupRepoReadFreeRate: 1,
                telemetryCoverageRate: 0.86,
                repeatFailureBursts: 0,
            },
        },
        coverage: {
            gaps: ["Startup transcript telemetry is only partially captured; 86% of startup entries carried both Grounding and repo-read signals."],
        },
        launcherCoverage: {
            liveStartupSamples: 7,
            requiredLiveStartupSamples: 5,
            trustworthy: true,
        },
        rubric: {
            overallScore: 98,
            grade: "A",
        },
        recommendations: ["Startup quality is within the current thresholds; keep collecting history so future regressions are easier to spot."],
    }, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(root, "output", "agent-runs", "run-background-1", "summary.json"), `${JSON.stringify({
        schema: "agent-runtime-summary.v1",
        generatedAt: "2026-03-30T10:06:00.000Z",
        runId: "run-background-1",
        missionId: "mission-background-1",
        hostId: "studio-brain-server",
        agentId: "agent-runtime",
        environment: "server",
        status: "blocked",
        riskLane: "high_risk",
        title: "Portal Runtime Mission",
        goal: "Keep the portal launch lane bounded.",
        groundingSources: ["codex-startup-preflight", "studio-brain-memory-brief", "git-status"],
        acceptance: {
            total: 3,
            pending: 1,
            completed: 1,
            failed: 1,
        },
        activeBlockers: ["Verifier checks failed."],
        ratholeSignals: [
            {
                signalId: "rathole-1",
                kind: "repeat_verifier_failure",
                severity: "critical",
                summary: "Verifier checks failed repeatedly without a state change.",
                recommendedAction: "Re-ground the mission and stop retrying until the blocker is explicit.",
                createdAt: "2026-03-30T10:06:00.000Z",
                blocking: true,
            },
        ],
        memoriesInfluencingRun: ["Portal continuity is loaded and ready for the next safe move."],
        goalMisses: [
            {
                category: "verification_omission",
                summary: "Verifier command failed: npm run startup:check",
                createdAt: "2026-03-30T10:06:00.000Z",
            },
        ],
        lastEventType: "rathole.detected",
        updatedAt: "2026-03-30T10:06:00.000Z",
        partner: {
            initiativeState: "waiting_on_owner",
            lastMeaningfulContactAt: "2026-03-30T10:01:00.000Z",
            nextCheckInAt: "2026-03-30T12:00:00.000Z",
            cooldownUntil: null,
            needsOwnerDecision: true,
            contactReason: "Studio Brain verified the blocked portal lane and is asking for one owner decision before it keeps moving.",
            verifiedContext: [
                "Verifier checks failed.",
                "Portal room is still waiting for direction.",
                "Memory brief still recommends inspecting the portal lane.",
            ],
            singleDecisionNeeded: "Decide whether to unblock the portal lane now or pause it until the verifier is fixed.",
            idleBudget: {
                policy: "one_task_at_a_time",
                maxConcurrentTasks: 1,
                maxAttemptsPerLoop: 2,
                rankedBacklog: [
                    "stale blocker cleanup",
                    "unresolved review queues",
                    "memory hygiene",
                ],
                verifyBeforeReport: true,
                contactOnlyOnMeaningfulChange: true,
            },
            openLoops: [
                {
                    id: "room:portal",
                    title: "Portal lane waiting on decision",
                    status: "open",
                    summary: "Portal room is blocked behind verifier drift and still needs a bounded next move.",
                    next: "Inspect portal lane",
                    source: "control-tower-room:portal",
                    updatedAt: "2026-03-30T10:06:00.000Z",
                    roomId: "portal",
                    sessionName: "sb-room",
                    decisionNeeded: "Decide whether to unblock, pause, or redirect this lane.",
                    verifiedContext: [
                        "Portal room stayed attached to the operator board.",
                        "Verifier checks failed repeatedly.",
                    ],
                    evidence: ["monsoonfire-portal", "Codex", "sb-room"],
                },
            ],
        },
        boardRow: {
            id: "agent-runtime:run-background-1",
            owner: "agent-runtime",
            task: "Portal Runtime Mission",
            state: "blocked",
            blocker: "Verifier checks failed.",
            next: "Inspect runtime",
            last_update: "2026-03-30T10:06:00.000Z",
            runId: "run-background-1",
            contactReason: "Studio Brain verified the blocked portal lane and is asking for one owner decision before it keeps moving.",
            verifiedContext: [
                "Verifier checks failed.",
                "Portal room is still waiting for direction.",
            ],
            decisionNeeded: "Decide whether to unblock the portal lane now or pause it until the verifier is fixed.",
        },
    }, null, 2)}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(root, "output", "agent-runs", "run-background-1", "run-ledger.jsonl"), `${JSON.stringify({
        schema: "agent-run-ledger-event.v1",
        eventId: "evt-1",
        runId: "run-background-1",
        missionId: "mission-background-1",
        type: "mission.state.changed",
        occurredAt: "2026-03-30T10:06:00.000Z",
        payload: { status: "blocked" },
    })}\n`, "utf8");
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(root, "output", "agent-runs", "latest.json"), `${JSON.stringify({
        schema: "agent-runtime-pointer.v1",
        runId: "run-background-1",
        updatedAt: "2026-03-30T10:06:00.000Z",
    }, null, 2)}\n`, "utf8");
    return {
        root,
        cleanup() {
            (0, node_fs_1.rmSync)(root, { recursive: true, force: true });
        },
    };
}
function createControlTowerRunner() {
    const sessions = new Map([
        ["studiobrain", { cwd: "/home/wuff/monsoonfire-portal", command: "bash", sessionActivity: "1711792800", paneId: "%100", attached: true }],
        ["sb-room", { cwd: "/home/wuff/monsoonfire-portal", command: "codex", room: "portal", sessionActivity: "1711796400", paneId: "%101" }],
    ]);
    const sentTexts = [];
    const serviceActions = [];
    const runner = (command, args = []) => {
        if (command === "tmux" && args[0] === "list-panes" && args.includes("-a")) {
            const format = Array.from(sessions.entries()).flatMap(([sessionName, session]) => {
                const isRoot = sessionName === "studiobrain";
                const windowName = isRoot ? "control" : "work";
                return [
                    [
                        sessionName,
                        windowName,
                        "0",
                        "1",
                        "0",
                        "1",
                        session.command,
                        session.cwd,
                        windowName,
                        "0",
                        session.paneId,
                        session.attached ? "1" : "0",
                        session.sessionActivity,
                        `@${sessionName}`,
                    ].join("\u001f"),
                ];
            });
            return { ok: true, rc: 0, stdout: format.join("\n"), stderr: "", command: "tmux list-panes" };
        }
        if (command === "tmux" && args[0] === "has-session") {
            const sessionName = String(args[2] || "");
            const exists = sessions.has(sessionName);
            return { ok: exists, rc: exists ? 0 : 1, stdout: "", stderr: exists ? "" : "missing", command: "tmux has-session" };
        }
        if (command === "tmux" && args[0] === "new-session") {
            const sessionName = String(args[3] || "");
            const cwd = String(args[5] || "/home/wuff/monsoonfire-portal");
            const sessionCommand = String(args[6] || "bash");
            sessions.set(sessionName, {
                cwd,
                command: sessionCommand,
                sessionActivity: "1711798200",
                paneId: `%${sessions.size + 101}`,
            });
            return { ok: true, rc: 0, stdout: "", stderr: "", command: "tmux new-session" };
        }
        if (command === "tmux" && args[0] === "list-panes" && args[1] === "-t") {
            const sessionName = String(args[2] || "");
            const session = sessions.get(sessionName);
            if (!session)
                return { ok: false, rc: 1, stdout: "", stderr: "missing", command: "tmux list-panes -t" };
            return { ok: true, rc: 0, stdout: session.paneId, stderr: "", command: "tmux list-panes -t" };
        }
        if (command === "tmux" && args[0] === "send-keys") {
            const paneId = String(args[2] || "");
            const session = Array.from(sessions.entries()).find(([, entry]) => entry.paneId === paneId)?.[0] ?? "unknown";
            if (args.includes("-l")) {
                const text = String(args[4] || "");
                sentTexts.push({ session, text });
            }
            return { ok: true, rc: 0, stdout: "", stderr: "", command: "tmux send-keys" };
        }
        if (command === "systemctl" && args[0] === "show") {
            const service = String(args[1] || "");
            const activeState = service === "studio-brain-discord-relay" ? "inactive" : "active";
            const subState = service === "studio-brain-discord-relay" ? "dead" : "running";
            return {
                ok: true,
                rc: 0,
                stdout: `ActiveState=${activeState}\nSubState=${subState}\nUnitFileState=enabled`,
                stderr: "",
                command: "systemctl show",
            };
        }
        if (command === "systemctl") {
            serviceActions.push({ action: String(args[0] || ""), service: String(args[1] || "") });
            return { ok: true, rc: 0, stdout: "", stderr: "", command: "systemctl action" };
        }
        return { ok: false, rc: 1, stdout: "", stderr: "unsupported", command: `${command} ${args.join(" ")}` };
    };
    return { runner, sentTexts, serviceActions };
}
(0, node_test_1.default)("health endpoint returns ok", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/healthz`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 200);
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.service, "studio-brain");
    });
});
(0, node_test_1.default)("readyz fails when snapshot freshness is required and missing", async () => {
    await withServer({
        requireFreshSnapshotForReady: true,
        readyMaxSnapshotAgeMinutes: 10,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/readyz`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 503);
        strict_1.default.equal(payload.ok, false);
    });
});
(0, node_test_1.default)("readyz succeeds without requiring fresh snapshot", async () => {
    await withServer({
        requireFreshSnapshotForReady: false,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/readyz`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 200);
        strict_1.default.equal(payload.ok, true);
    });
});
(0, node_test_1.default)("status endpoint includes runtime payload and recent jobs", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    await stateStore.startJobRun("computeStudioState");
    await withServer({
        stateStore,
        getRuntimeStatus: () => ({ scheduler: { intervalMs: 1000 }, custom: "ok" }),
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/status`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 200);
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.runtime.custom, "ok");
        strict_1.default.ok(Array.isArray(payload.jobRuns));
        strict_1.default.ok(payload.jobRuns.length >= 1);
    });
});
(0, node_test_1.default)("metrics endpoint includes process payload", async () => {
    await withServer({
        getRuntimeMetrics: () => ({ scheduler: { intervalMs: 1000 } }),
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/metrics`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 200);
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(payload.metrics.process.pid > 0);
        strict_1.default.ok(payload.metrics.process.uptimeSec >= 0);
    });
});
(0, node_test_1.default)("wiki endpoints expose read-only context, contradictions, freshness, and search", async () => {
    const wikiReadStore = {
        async getContextPack(input) {
            strict_1.default.equal(input.tenantScope, "monsoonfire-main");
            strict_1.default.equal(input.packKey, "studio-brain-wiki");
            return {
                contextPackId: "ctx_test",
                tenantScope: input.tenantScope,
                packKey: input.packKey,
                title: "Studio Brain Wiki",
                status: "active",
                generatedText: "Verified wiki context.",
                budget: { chars: 22 },
                warnings: [],
                exportHash: "hash-context",
                generatedAt: "2026-04-28T00:00:00.000Z",
                validUntil: null,
                metadata: {},
            };
        },
        async listContradictions(input) {
            strict_1.default.equal(input.status, "open");
            strict_1.default.equal(input.limit, 5);
            return [
                {
                    contradictionId: "contradiction_test",
                    tenantScope: input.tenantScope,
                    conflictKey: "membership-required-vs-decommission",
                    severity: "hard",
                    status: "open",
                    claimAId: null,
                    claimBId: null,
                    sourceRefs: [],
                    owner: "policy",
                    recommendedAction: "Review membership policy.",
                    markdownPath: "wiki/50_contradictions/membership-required-vs-decommission.md",
                    openedAt: "2026-04-28T00:00:00.000Z",
                    updatedAt: "2026-04-28T00:00:00.000Z",
                    resolvedAt: null,
                    metadata: {},
                },
            ];
        },
        async listSourceFreshness(input) {
            strict_1.default.equal(input.status, "stale");
            return [
                {
                    sourceId: "src_test",
                    tenantScope: input.tenantScope,
                    sourceKind: "repo-file",
                    sourcePath: "docs/policy.md",
                    sourceUri: null,
                    authorityClass: "policy",
                    contentHash: "hash-source",
                    freshnessStatus: "stale",
                    ingestStatus: "indexed",
                    denyReason: null,
                    lastIndexedAt: "2026-04-28T00:00:00.000Z",
                    lastChangedAt: null,
                    updatedAt: "2026-04-28T00:00:00.000Z",
                    metadata: {},
                },
            ];
        },
        async search(input) {
            strict_1.default.equal(input.query, "membership");
            return [
                {
                    itemType: "claim",
                    itemId: "claim_test",
                    title: "membership policy",
                    snippet: "Membership policy needs review.",
                    status: "EXTRACTED",
                    sourcePath: "docs/policy.md",
                    rank: 0.9,
                    updatedAt: "2026-04-28T00:00:00.000Z",
                    metadata: {},
                },
            ];
        },
    };
    await withServer({ wikiReadStore }, async (baseUrl) => {
        const headers = { authorization: "Bearer test-staff" };
        const contextResponse = await fetch(`${baseUrl}/api/wiki/context-packs/studio-brain-wiki`, { headers });
        strict_1.default.equal(contextResponse.status, 200);
        const contextPayload = (await contextResponse.json());
        strict_1.default.equal(contextPayload.ok, true);
        strict_1.default.equal(contextPayload.contextPack.contextPackId, "ctx_test");
        const contradictionResponse = await fetch(`${baseUrl}/api/wiki/contradictions?status=open&limit=5`, { headers });
        strict_1.default.equal(contradictionResponse.status, 200);
        const contradictionPayload = (await contradictionResponse.json());
        strict_1.default.equal(contradictionPayload.contradictions[0]?.conflictKey, "membership-required-vs-decommission");
        const freshnessResponse = await fetch(`${baseUrl}/api/wiki/source-freshness?status=stale`, { headers });
        strict_1.default.equal(freshnessResponse.status, 200);
        const freshnessPayload = (await freshnessResponse.json());
        strict_1.default.equal(freshnessPayload.sources[0]?.freshnessStatus, "stale");
        const searchResponse = await fetch(`${baseUrl}/api/wiki/search?q=membership`, { headers });
        strict_1.default.equal(searchResponse.status, 200);
        const searchPayload = (await searchResponse.json());
        strict_1.default.equal(searchPayload.results[0]?.itemId, "claim_test");
        const badSearchResponse = await fetch(`${baseUrl}/api/wiki/search`, { headers });
        strict_1.default.equal(badSearchResponse.status, 400);
    });
});
(0, node_test_1.default)("overseer endpoints return latest run payload and bounded history", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    await stateStore.saveOverseerRun(buildSampleOverseerRun());
    await stateStore.saveOverseerRun(buildSampleOverseerRun({
        runId: "ovr_test_2",
        computedAt: "2026-03-30T11:00:00.000Z",
        overallStatus: "critical",
        delivery: {
            dedupeKey: "dedupe-2",
            changed: false,
            matchedRunId: "ovr_test_1",
            discord: {
                enabled: true,
                shouldNotify: false,
                summary: "Overseer critical",
                lines: ["status=critical"],
            },
            cli: {
                summary: "Overseer critical",
                detailPath: "output/overseer/latest.json",
                hints: ["GET /api/overseer/latest"],
            },
        },
    }));
    await withServer({ stateStore }, async (baseUrl) => {
        const latest = await fetch(`${baseUrl}/api/overseer/latest`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(latest.status, 200);
        const latestPayload = (await latest.json());
        strict_1.default.equal(latestPayload.ok, true);
        strict_1.default.equal(latestPayload.overseer.runId, "ovr_test_2");
        strict_1.default.equal(latestPayload.overseer.overallStatus, "critical");
        const runs = await fetch(`${baseUrl}/api/overseer/runs?limit=1`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(runs.status, 200);
        const runsPayload = (await runs.json());
        strict_1.default.equal(runsPayload.ok, true);
        strict_1.default.equal(runsPayload.rows.length, 1);
        strict_1.default.equal(runsPayload.rows[0].runId, "ovr_test_2");
    });
});
(0, node_test_1.default)("overseer endpoints require staff auth", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    await stateStore.saveOverseerRun(buildSampleOverseerRun());
    await withServer({ stateStore }, async (baseUrl) => {
        const unauth = await fetch(`${baseUrl}/api/overseer/latest`);
        strict_1.default.equal(unauth.status, 401);
        const nonStaff = await fetch(`${baseUrl}/api/overseer/runs?limit=5`, {
            headers: { authorization: "Bearer test-member" },
        });
        strict_1.default.equal(nonStaff.status, 401);
    });
});
(0, node_test_1.default)("overseer discord endpoint returns latest delivery payload", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    await stateStore.saveOverseerRun(buildSampleOverseerRun());
    await withServer({ stateStore }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/overseer/discord/latest`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.discord.runId, "ovr_test_1");
        strict_1.default.equal(payload.discord.delivery.mcp?.serverName, "discord");
        strict_1.default.equal(payload.discord.delivery.target?.channelId, "channel-1");
    });
});
(0, node_test_1.default)("support persona endpoint returns Ember profile", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/support-ops/persona`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.persona.displayName, "Ember");
        strict_1.default.equal(payload.persona.fromName, "Ember at Monsoon Fire");
        strict_1.default.equal(payload.persona.avatarAssetPath, "/support-agent/ember-avatar.svg");
        strict_1.default.equal(payload.persona.startup.operatingMode, "hybrid_warm_touch");
        strict_1.default.equal(payload.persona.startup.fileReferences[1], "config/studiobrain/agents/ember/system-prompt.md");
        strict_1.default.match(payload.persona.startup.profileCard.badge, /policy-governed/i);
    });
});
(0, node_test_1.default)("support discord respond endpoint drafts a safe Ember reply", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/support-ops/discord/respond`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                channelId: "channel-1",
                senderName: "Betsy",
                question: "Could I do 8 PM instead or porch drop-off if that is easier?",
            }),
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.draft.persona.displayName, "Ember");
        strict_1.default.equal(payload.draft.policySlug, "firing-scheduling");
        strict_1.default.equal(payload.draft.replyMode, "template");
        strict_1.default.match(payload.draft.reply, /same-day pickup is not guaranteed/i);
    });
});
(0, node_test_1.default)("memory review endpoints list, fetch, and act on review cases", async () => {
    await withServer({}, async (baseUrl) => {
        await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Decision: startup continuity auth drift is resolved.",
                source: "manual",
                tags: ["decision"],
                memoryCategory: "decision",
                metadata: {
                    subjectKey: "startup-continuity-auth-drift",
                    loopState: "resolved",
                },
            }),
        });
        await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Decision: startup continuity auth drift is still open.",
                source: "manual",
                tags: ["decision"],
                memoryCategory: "decision",
                metadata: {
                    subjectKey: "startup-continuity-auth-drift",
                    loopState: "open-loop",
                },
            }),
        });
        const listResponse = await fetch(`${baseUrl}/api/memory/review-cases`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(listResponse.status, 200);
        const listPayload = (await listResponse.json());
        strict_1.default.equal(listPayload.ok, true);
        strict_1.default.equal(listPayload.rows.length >= 1, true);
        strict_1.default.equal(listPayload.rows[0].caseType, "resolve-conflict");
        strict_1.default.equal(listPayload.latestVerificationRuns.length >= 1, true);
        const caseId = listPayload.rows[0].id;
        const getResponse = await fetch(`${baseUrl}/api/memory/review-cases/${encodeURIComponent(caseId)}`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(getResponse.status, 200);
        const getPayload = (await getResponse.json());
        strict_1.default.equal(getPayload.ok, true);
        strict_1.default.equal(getPayload.reviewCase.id, caseId);
        strict_1.default.equal(getPayload.reviewCase.recommendedActions.includes("verify_now"), true);
        const actionResponse = await fetch(`${baseUrl}/api/memory/review-cases/${encodeURIComponent(caseId)}/actions`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                action: "verify_now",
                actorId: "staff-test-uid",
                selectedMemoryId: listPayload.rows[0].primaryMemoryId,
            }),
        });
        strict_1.default.equal(actionResponse.status, 200);
        const actionPayload = (await actionResponse.json());
        strict_1.default.equal(actionPayload.ok, true);
        strict_1.default.equal(actionPayload.reviewCase.id, caseId);
        strict_1.default.equal(actionPayload.reviewCase.status === "in-progress" || actionPayload.reviewCase.status === "resolved", true);
    });
});
(0, node_test_1.default)("support queue endpoint returns Ember review link metadata", async () => {
    const memoryService = (0, service_2.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "monsoonfire-main",
        defaultAgentId: "test-agent",
        defaultRunId: "test-run",
    });
    await memoryService.capture({
        content: "Stale Ember timing guidance for pickup wording needs revalidation.",
        source: "manual",
        memoryCategory: "procedure",
        occurredAt: "2025-01-10T00:00:00.000Z",
        metadata: {
            scope: "run:ember-support:email:support-conversation-case-1",
            subjectKey: "ember:pattern:firing-scheduling",
        },
    });
    const supportOpsStore = {
        async getMailboxState() { return null; },
        async saveMailboxState() { },
        async hasProcessedMessage() { return false; },
        async saveMessageRecord() { },
        async getCaseSnapshot() { return null; },
        async saveCaseSnapshot() { },
        async listRecentCases() {
            return [{
                    supportRequestId: "support-case-1",
                    provider: "namecheap_private_email",
                    mailbox: "support@monsoonfire.com",
                    conversationKey: "support-conversation-case-1",
                    sourceThreadId: "thread-1",
                    sourceThreadIds: ["thread-1"],
                    sourceMessageId: "msg-1",
                    latestSourceMessageId: "msg-1",
                    threadDriftFlag: false,
                    senderEmail: "member@example.com",
                    senderVerifiedUid: null,
                    subject: "Pickup timing question",
                    decision: "staff_review",
                    riskState: "clear",
                    riskReasons: [],
                    automationState: "staff_review",
                    queueBucket: "staff_review",
                    unread: true,
                    memberCareState: "due",
                    memberCareReason: "pickup_coordination",
                    lastCareTouchAt: null,
                    careTouchCount: 0,
                    lastOperatorActionAt: null,
                    nextRecommendedAction: "Review timing details and reply warmly.",
                    supportSummary: "Member is confused about pickup timing.",
                    emberMemoryScope: "run:ember-support:email:support-conversation-case-1",
                    emberSummary: "Pickup timing confusion.",
                    confusionState: "uncertain",
                    confusionReason: "timing-or-clarification",
                    humanHandoff: true,
                    linkedMemoryReviewCaseIds: [],
                    policyResolution: {
                        intentId: null,
                        policySlug: "firing-scheduling",
                        policyVersion: "2026-04-14",
                        discrepancyFlag: false,
                        escalationReason: null,
                        matchedTerms: ["pickup", "timing"],
                        requiredSignals: [],
                        missingSignals: [],
                        allowedLowRiskActions: ["reply_with_ready_window"],
                        blockedActions: [],
                        replyTemplate: "Thanks for checking. We will confirm once your work is ready.",
                        difficultProcessGuidance: [],
                        practiceEvidenceIds: [],
                        practiceEvidence: [],
                        warmTouchPlaybook: null,
                    },
                    replyDraft: null,
                    proposalId: null,
                    proposalCapabilityId: null,
                    lastReceivedAt: "2026-04-14T12:00:00.000Z",
                    updatedAt: "2026-04-14T12:05:00.000Z",
                    rawSnapshot: {},
                }];
        },
        async getQueueSummary() {
            return {
                unread: 1,
                awaitingInfo: 0,
                awaitingApproval: 0,
                securityHold: 0,
                staffReview: 1,
                warmTouchesDue: 1,
                splitThreadSuspects: 0,
                totalOpen: 1,
                oldestOpenAt: "2026-04-14T12:00:00.000Z",
                slaAging: { fresh: 1, warning: 0, overdue: 0 },
            };
        },
        async addDeadLetter() { throw new Error("not used"); },
        async listDeadLetters() { return []; },
    };
    await withServer({ memoryService, supportOpsStore }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/support-ops/queue?limit=5`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.recentCases[0].emberMemoryScope, "run:ember-support:email:support-conversation-case-1");
        strict_1.default.equal((payload.recentCases[0].linkedMemoryReviewCaseIds?.length ?? 0) >= 1, true);
    });
});
(0, node_test_1.default)("memory endpoints capture, search, recent, stats, and import", async () => {
    await withServer({}, async (baseUrl) => {
        const captured = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Decision: move launch to March 15 after QA payment blockers.",
                source: "manual",
                tags: ["decision", "launch"],
                metadata: { owner: "rachel" },
            }),
        });
        strict_1.default.equal(captured.status, 201);
        const capturePayload = (await captured.json());
        strict_1.default.equal(capturePayload.ok, true);
        strict_1.default.ok(capturePayload.memory.id.startsWith("mem_"));
        const startupHandoff = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Handoff: verify startup continuity before launch.",
                source: "codex-handoff",
                metadata: {
                    rememberKind: "handoff",
                    startupEligible: true,
                    threadId: "thread-http-memory-stats",
                    threadEvidence: "explicit",
                },
            }),
        });
        strict_1.default.equal(startupHandoff.status, 201);
        const secretCapture = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Operator note: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.signature-value-0987654321",
                source: "manual",
            }),
        });
        strict_1.default.equal(secretCapture.status, 201);
        const shadowMcpCapture = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Connector result: MCP surfaced a repo sync status from an unapproved server.",
                source: "mcp-tool:repo-sync",
                metadata: {
                    mcpGovernance: {
                        approvalState: "pending",
                        shadowRisk: true,
                    },
                },
            }),
        });
        strict_1.default.equal(shadowMcpCapture.status, 201);
        const searched = await fetch(`${baseUrl}/api/memory/search`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({ query: "QA payment blockers", limit: 5 }),
        });
        strict_1.default.equal(searched.status, 200);
        const searchPayload = (await searched.json());
        strict_1.default.equal(searchPayload.ok, true);
        strict_1.default.ok(searchPayload.rows.some((row) => row.id === capturePayload.memory.id));
        const recent = await fetch(`${baseUrl}/api/memory/recent?limit=5`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(recent.status, 200);
        const recentPayload = (await recent.json());
        strict_1.default.equal(recentPayload.ok, true);
        strict_1.default.ok(recentPayload.rows.length >= 1);
        const stats = await fetch(`${baseUrl}/api/memory/stats`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(stats.status, 200);
        const statsPayload = (await stats.json());
        strict_1.default.equal(statsPayload.ok, true);
        strict_1.default.ok(statsPayload.stats.total >= 1);
        strict_1.default.ok(statsPayload.stats.bySource.some((entry) => entry.source === "manual"));
        strict_1.default.equal((statsPayload.stats.startupReadiness?.startupEligibleRows ?? 0) >= 1, true);
        strict_1.default.equal((statsPayload.stats.startupReadiness?.handoffRows ?? 0) >= 1, true);
        strict_1.default.equal((statsPayload.stats.secretExposureFindings?.canonicalBlockedRows ?? 0) >= 1, true);
        strict_1.default.equal((statsPayload.stats.shadowMcpFindings?.highRiskRows ?? 0) >= 1, true);
        const context = await fetch(`${baseUrl}/api/memory/context`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                agentId: "test-agent",
                runId: "test-agent:main",
                query: "QA blockers",
                maxItems: 3,
                maxChars: 512,
            }),
        });
        strict_1.default.equal(context.status, 200);
        const contextPayload = (await context.json());
        strict_1.default.equal(contextPayload.ok, true);
        strict_1.default.ok(contextPayload.context.items.length >= 1);
        strict_1.default.equal(contextPayload.context.budget.maxItems, 3);
        strict_1.default.equal(contextPayload.context.budget.maxChars, 512);
        const imported = await fetch(`${baseUrl}/api/memory/import`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                sourceOverride: "import",
                items: [
                    { content: "Marcus mentioned onboarding confusion around permissions." },
                    { content: "Insight: pricing FAQ needs examples for kiln scheduling." },
                ],
            }),
        });
        strict_1.default.equal(imported.status, 201);
        const importPayload = (await imported.json());
        strict_1.default.equal(importPayload.ok, true);
        strict_1.default.equal(importPayload.result.imported, 2);
        strict_1.default.equal(importPayload.result.failed, 0);
    });
});
(0, node_test_1.default)("memory import returns 429 when the import concurrency breaker is saturated", async () => {
    const previousLimit = process.env.STUDIO_BRAIN_MAX_ACTIVE_IMPORT_REQUESTS;
    process.env.STUDIO_BRAIN_MAX_ACTIVE_IMPORT_REQUESTS = "1";
    let resolveImportStarted = () => { };
    let releaseImport = () => { };
    const importStarted = new Promise((resolve) => {
        resolveImportStarted = resolve;
    });
    const importRelease = new Promise((resolve) => {
        releaseImport = resolve;
    });
    const memoryService = (0, service_2.createMemoryService)({
        store: (0, inMemoryAdapter_1.createInMemoryMemoryStoreAdapter)(),
        defaultTenantId: "monsoonfire-main",
        defaultAgentId: "test-agent",
        defaultRunId: "test-run",
    });
    memoryService.importBatch = async () => {
        resolveImportStarted();
        await importRelease;
        return { total: 1, imported: 1, failed: 0, results: [{ index: 0, ok: true, id: "mem-test" }] };
    };
    try {
        await withServer({
            memoryService,
        }, async (baseUrl) => {
            const first = fetch(`${baseUrl}/api/memory/import`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
                body: JSON.stringify({ sourceOverride: "import", items: [{ content: "first import" }] }),
            });
            await Promise.race([
                importStarted,
                new Promise((_, reject) => setTimeout(() => reject(new Error("Timed out waiting for import to start.")), 1_000)),
            ]);
            const second = await fetch(`${baseUrl}/api/memory/import`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
                body: JSON.stringify({ sourceOverride: "import", items: [{ content: "second import" }] }),
            });
            strict_1.default.equal(second.status, 429);
            strict_1.default.equal(second.headers.get("retry-after"), "20");
            const secondPayload = (await second.json());
            strict_1.default.equal(secondPayload.ok, false);
            strict_1.default.equal(secondPayload.reason, "active-import-pressure");
            strict_1.default.equal(secondPayload.pressure?.activeImportRequests, 1);
            releaseImport();
            const firstResponse = await first;
            strict_1.default.equal(firstResponse.status, 201);
        });
    }
    finally {
        releaseImport();
        if (previousLimit === undefined) {
            delete process.env.STUDIO_BRAIN_MAX_ACTIVE_IMPORT_REQUESTS;
        }
        else {
            process.env.STUDIO_BRAIN_MAX_ACTIVE_IMPORT_REQUESTS = previousLimit;
        }
    }
});
(0, node_test_1.default)("memory neighborhood endpoint returns ranked rows with relationship diagnostics", async () => {
    await withServer({}, async (baseUrl) => {
        const first = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Parent decision for glaze sequencing.",
                source: "manual",
                metadata: { owner: "ops" },
            }),
        });
        strict_1.default.equal(first.status, 201);
        const firstPayload = (await first.json());
        const second = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Follow-up thread item with kiln loading constraints.",
                source: "manual",
                metadata: { owner: "ops" },
            }),
        });
        strict_1.default.equal(second.status, 201);
        const secondPayload = (await second.json());
        const seed = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Seed note: reopen and resolve conflict now visible for diagnostics.",
                source: "manual",
                metadata: {
                    relatedMemoryIds: [firstPayload.memory.id, secondPayload.memory.id],
                    resolvesMemoryId: firstPayload.memory.id,
                    reopensMemoryId: firstPayload.memory.id,
                    relationships: [{ targetId: secondPayload.memory.id, relationType: "dependsOn" }],
                },
            }),
        });
        strict_1.default.equal(seed.status, 201);
        const seedPayload = (await seed.json());
        const response = await fetch(`${baseUrl}/api/memory/neighborhood`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                seedMemoryId: seedPayload.memory.id,
                maxHops: 2,
                maxItems: 8,
            }),
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.neighborhood.seedMemoryId, seedPayload.memory.id);
        strict_1.default.ok(payload.neighborhood.nodes.some((row) => row.id === seedPayload.memory.id));
        strict_1.default.ok(payload.edgeSummary.nodeCount >= 1);
        strict_1.default.ok(Number(payload.relationshipTypeCounts.related ?? 0) >= 1);
        strict_1.default.ok(payload.edgeSummary.unresolvedConflictCount >= 1);
        strict_1.default.ok(payload.diagnostics.previewSummaries.length >= 1);
    });
});
(0, node_test_1.default)("relationship diagnostics endpoint validates requests and returns edge summary contract", async () => {
    await withServer({}, async (baseUrl) => {
        const capture = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Ticket handoff note with continuity and queue context.",
                source: "manual",
            }),
        });
        strict_1.default.equal(capture.status, 201);
        const invalid = await fetch(`${baseUrl}/api/memory/relationship-diagnostics`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({ maxItems: 8 }),
        });
        strict_1.default.equal(invalid.status, 400);
        const response = await fetch(`${baseUrl}/api/memory/relationship-diagnostics`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                query: "handoff continuity queue",
                maxItems: 8,
                maxHops: 2,
            }),
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.diagnostics.query, "handoff continuity queue");
        strict_1.default.ok(payload.diagnostics.edgeSummary.nodeCount >= 1);
        strict_1.default.ok(payload.diagnostics.edgeSummary.edgeCount >= 0);
        strict_1.default.equal(typeof payload.diagnostics.relationshipTypeCounts, "object");
        strict_1.default.ok(payload.diagnostics.previewSummaries.length >= 1);
    });
});
(0, node_test_1.default)("memory endpoints require staff auth", async () => {
    await withServer({}, async (baseUrl) => {
        const unauth = await fetch(`${baseUrl}/api/memory/stats`);
        strict_1.default.equal(unauth.status, 401);
        const contextUnauth = await fetch(`${baseUrl}/api/memory/context`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ maxItems: 5 }),
        });
        strict_1.default.equal(contextUnauth.status, 401);
        const nonStaff = await fetch(`${baseUrl}/api/memory/stats`, {
            headers: { authorization: "Bearer test-member" },
        });
        strict_1.default.equal(nonStaff.status, 401);
    });
});
(0, node_test_1.default)("memory consolidation executes on the host control plane and records an audit event", async () => {
    const eventStore = new memoryStores_1.MemoryEventStore();
    await withServer({
        eventStore,
        adminToken: "admin-secret",
    }, async (baseUrl) => {
        const blocked = await fetch(`${baseUrl}/api/memory/consolidate`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({ mode: "idle", runId: "memory-consolidation-test-blocked" }),
        });
        strict_1.default.equal(blocked.status, 401);
        const response = await fetch(`${baseUrl}/api/memory/consolidate`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: "Bearer test-staff",
                "x-studio-brain-admin-token": "admin-secret",
            },
            body: JSON.stringify({
                mode: "idle",
                runId: "memory-consolidation-test",
                maxCandidates: 10,
                maxWrites: 5,
                timeBudgetMs: 15000,
                focusAreas: ["Portal continuity"],
                requestOrigin: "studio-brain-mcp",
                requestedTransport: "http",
            }),
        });
        strict_1.default.equal(response.status, 200);
        const payload = await response.json();
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(typeof payload.result?.status, "string");
        strict_1.default.equal(payload.result?.focusAreas?.includes("Portal continuity"), true);
        const rows = await eventStore.listRecent(10);
        strict_1.default.equal(rows.some((row) => row.action === "studio_brain.memory_consolidated"), true);
    });
});
(0, node_test_1.default)("memory ingest endpoint is disabled by default", async () => {
    await withServer({}, async (baseUrl) => {
        const payload = {
            content: "Insight: permissions onboarding needs simpler defaults.",
            source: "discord",
            clientRequestId: "req-disabled-1",
            metadata: {
                discordGuildId: "guild-1",
                discordChannelId: "channel-1",
            },
        };
        const response = await fetch(`${baseUrl}/api/memory/ingest`, {
            method: "POST",
            headers: buildIngestHeaders("unused-secret", payload),
            body: JSON.stringify(payload),
        });
        strict_1.default.equal(response.status, 404);
    });
});
(0, node_test_1.default)("memory ingest accepts valid signed discord payloads when enabled", async () => {
    await withServer({
        memoryIngestConfig: {
            enabled: true,
            hmacSecret: "ingest-secret",
            allowedSources: ["discord"],
            allowedDiscordGuildIds: ["guild-1"],
            allowedDiscordChannelIds: ["channel-1"],
            requireClientRequestId: true,
        },
    }, async (baseUrl) => {
        const payload = {
            content: "Decision: keep onboarding copy in plain language for Discord users.",
            source: "discord",
            clientRequestId: "discord-msg-123",
            metadata: {
                discordGuildId: "guild-1",
                discordChannelId: "channel-1",
                authorId: "user-99",
            },
        };
        const response = await fetch(`${baseUrl}/api/memory/ingest`, {
            method: "POST",
            headers: buildIngestHeaders("ingest-secret", payload),
            body: JSON.stringify(payload),
        });
        strict_1.default.equal(response.status, 201);
        const body = (await response.json());
        strict_1.default.equal(body.ok, true);
        strict_1.default.ok(body.memory.id.startsWith("mem_req_"));
        strict_1.default.equal(body.memory.source, "discord");
    });
});
(0, node_test_1.default)("memory ingest rejects stale signatures, invalid signature, and missing client request id", async () => {
    await withServer({
        memoryIngestConfig: {
            enabled: true,
            hmacSecret: "ingest-secret",
            allowedSources: ["discord"],
            allowedDiscordGuildIds: ["guild-1"],
            allowedDiscordChannelIds: ["channel-1"],
            requireClientRequestId: true,
        },
    }, async (baseUrl) => {
        const stalePayload = {
            content: "Stale payload should be rejected.",
            source: "discord",
            clientRequestId: "req-stale-1",
            metadata: { discordGuildId: "guild-1", discordChannelId: "channel-1" },
        };
        const staleResponse = await fetch(`${baseUrl}/api/memory/ingest`, {
            method: "POST",
            headers: buildIngestHeaders("ingest-secret", stalePayload, Math.trunc(Date.now() / 1000) - 10_000),
            body: JSON.stringify(stalePayload),
        });
        strict_1.default.equal(staleResponse.status, 401);
        const invalidSigPayload = {
            content: "Invalid signature should be rejected.",
            source: "discord",
            clientRequestId: "req-bad-signature-1",
            metadata: { discordGuildId: "guild-1", discordChannelId: "channel-1" },
        };
        const invalidSigResponse = await fetch(`${baseUrl}/api/memory/ingest`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-memory-ingest-timestamp": `${Math.trunc(Date.now() / 1000)}`,
                "x-memory-ingest-signature": "v1=deadbeef",
            },
            body: JSON.stringify(invalidSigPayload),
        });
        strict_1.default.equal(invalidSigResponse.status, 401);
        const missingRequestIdPayload = {
            content: "Missing request id should be rejected.",
            source: "discord",
            metadata: { discordGuildId: "guild-1", discordChannelId: "channel-1" },
        };
        const missingRequestIdResponse = await fetch(`${baseUrl}/api/memory/ingest`, {
            method: "POST",
            headers: buildIngestHeaders("ingest-secret", missingRequestIdPayload),
            body: JSON.stringify(missingRequestIdPayload),
        });
        strict_1.default.equal(missingRequestIdResponse.status, 400);
    });
});
(0, node_test_1.default)("memory ingest enforces source and discord allowlists", async () => {
    await withServer({
        memoryIngestConfig: {
            enabled: true,
            hmacSecret: "ingest-secret",
            allowedSources: ["discord"],
            allowedDiscordGuildIds: ["guild-1"],
            allowedDiscordChannelIds: ["channel-1"],
            requireClientRequestId: true,
        },
    }, async (baseUrl) => {
        const blockedSourcePayload = {
            content: "This webhook source should be blocked.",
            source: "webhook",
            clientRequestId: "blocked-source-1",
        };
        const blockedSource = await fetch(`${baseUrl}/api/memory/ingest`, {
            method: "POST",
            headers: buildIngestHeaders("ingest-secret", blockedSourcePayload),
            body: JSON.stringify(blockedSourcePayload),
        });
        strict_1.default.equal(blockedSource.status, 403);
        const blockedGuildPayload = {
            content: "This guild should be blocked.",
            source: "discord",
            clientRequestId: "blocked-guild-1",
            metadata: {
                discordGuildId: "guild-x",
                discordChannelId: "channel-1",
            },
        };
        const blockedGuild = await fetch(`${baseUrl}/api/memory/ingest`, {
            method: "POST",
            headers: buildIngestHeaders("ingest-secret", blockedGuildPayload),
            body: JSON.stringify(blockedGuildPayload),
        });
        strict_1.default.equal(blockedGuild.status, 403);
    });
});
(0, node_test_1.default)("ops scorecard endpoint returns KPI status and records compute event", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const eventStore = new memoryStores_1.MemoryEventStore();
    await stateStore.saveStudioState({
        schemaVersion: "v3.0",
        snapshotDate: "2026-02-13",
        generatedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        cloudSync: {
            firestoreReadAt: new Date().toISOString(),
            stripeReadAt: null,
        },
        counts: { batchesActive: 1, batchesClosed: 1, reservationsOpen: 1, firingsScheduled: 1, reportsOpen: 1 },
        ops: { agentRequestsPending: 0, highSeverityReports: 0 },
        finance: { pendingOrders: 0, unsettledPayments: 0 },
        sourceHashes: { firestore: "hash", stripe: null },
        diagnostics: { completeness: "full", warnings: [] },
    });
    await withServer({
        stateStore,
        eventStore,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ops/scorecard`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(["ok", "warning", "critical"].includes(payload.scorecard.overallStatus));
        strict_1.default.equal(payload.scorecard.metrics.length, 5);
        const rows = await eventStore.listRecent(10);
        strict_1.default.ok(rows.some((row) => row.action === "studio_ops.scorecard_computed"));
    });
});
(0, node_test_1.default)("ops portal routes expose twin state and allow claiming tasks", async () => {
    const member = {
        uid: "member-1",
        email: "member@example.com",
        displayName: "Studio Member",
        membershipTier: "drop-in",
        kilnPreferences: "Cone 6 preferred",
        staffNotes: "Prefers pickup texts.",
        billing: null,
        portalRole: "member",
        opsRoles: [],
        opsCapabilities: [],
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        lastSeenAt: "2026-04-16T20:00:00.000Z",
        metadata: {},
    };
    const opsService = (0, service_1.createOpsService)({
        store: new store_1.MemoryOpsStore(),
        staffDataSource: {
            async listMembers() { return [member]; },
            async getMember(uid) { return uid === member.uid ? member : null; },
            async createMember() { throw new Error("not used in this test"); },
            async updateMemberProfile() { throw new Error("not used in this test"); },
            async updateMemberBilling() { throw new Error("not used in this test"); },
            async updateMemberMembership() { throw new Error("not used in this test"); },
            async updateMemberRole() { throw new Error("not used in this test"); },
            async getMemberActivity(uid) {
                return {
                    uid,
                    reservations: 1,
                    libraryLoans: 0,
                    supportThreads: 1,
                    events: 0,
                    lastReservationAt: member.lastSeenAt,
                    lastLoanAt: null,
                    lastEventAt: member.lastSeenAt,
                };
            },
            async listReservations() { return []; },
            async getReservationBundle() { return null; },
            async listEvents() { return []; },
            async listReports() { return []; },
            async getLendingSnapshot() {
                return {
                    requests: [],
                    loans: [],
                    recommendationCount: 0,
                    tagSubmissionCount: 0,
                    coverReviewCount: 0,
                    generatedAt: "2026-04-17T00:00:00.000Z",
                };
            },
        },
    });
    const task = (0, service_1.createHumanTaskSeed)({
        id: "task_ops_portal_claim",
        title: "Unload kiln 1",
        surface: "hands",
        role: "kiln_lead",
        zone: "Kiln Room",
        whyNow: "Kiln 1 is ready for unload.",
        whyYou: "Kiln leads own kiln unloading and proof.",
        evidenceSummary: "The kiln lane says the run is ready for unload.",
        consequenceIfDelayed: "The next firing stays blocked.",
        instructions: ["Open the kiln safely.", "Unload the ware.", "Record proof."],
        priority: "p0",
        proofModes: ["manual_confirm"],
        preferredProofMode: "manual_confirm",
    });
    await opsService.upsertTask(task);
    await withServer({
        opsService,
        opsPortalConfig: {
            enabled: true,
            requireStaffAuth: true,
            compareEnabled: true,
            legacyUrl: "https://portal.monsoonfire.com/staff",
        },
        adminToken: "test-ops-session-secret",
    }, async (baseUrl) => {
        const twinResponse = await fetch(`${baseUrl}/api/ops/twin`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(twinResponse.status, 200);
        const twinPayload = (await twinResponse.json());
        strict_1.default.equal(twinPayload.ok, true);
        strict_1.default.equal(typeof twinPayload.twin.headline, "string");
        const tasksResponse = await fetch(`${baseUrl}/api/ops/tasks`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(tasksResponse.status, 200);
        const tasksPayload = (await tasksResponse.json());
        strict_1.default.equal(tasksPayload.ok, true);
        strict_1.default.ok(tasksPayload.rows.some((row) => row.id === task.id));
        const claimResponse = await fetch(`${baseUrl}/api/ops/tasks/${encodeURIComponent(task.id)}/claim`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            },
            body: JSON.stringify({}),
        });
        strict_1.default.equal(claimResponse.status, 200);
        const claimPayload = (await claimResponse.json());
        strict_1.default.equal(claimPayload.ok, true);
        strict_1.default.equal(claimPayload.task.claimedBy, "staff-test-uid");
        strict_1.default.equal(claimPayload.task.status, "claimed");
        const unauthorizedPortalResponse = await fetch(`${baseUrl}/ops`);
        strict_1.default.equal(unauthorizedPortalResponse.status, 401);
        const portalResponse = await fetch(`${baseUrl}/ops`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(portalResponse.status, 200);
        const html = await portalResponse.text();
        strict_1.default.ok(html.includes("Command deck"));
        strict_1.default.ok(html.includes("Hands lane"));
        strict_1.default.ok(html.includes("Windows that move today"));
        strict_1.default.ok(html.includes('id="ops-hands-workbench"'));
        strict_1.default.ok(html.includes('id="ops-support-workbench"'));
        const marker = '<script id="ops-portal-model" type="application/json">';
        const modelStart = html.indexOf(marker);
        strict_1.default.ok(modelStart >= 0);
        const modelBodyStart = modelStart + marker.length;
        const modelEnd = html.indexOf("</script>", modelBodyStart);
        const portalModel = JSON.parse(html.slice(modelBodyStart, modelEnd));
        strict_1.default.equal(typeof portalModel.sessionToken, "string");
        const sessionHeaders = { "x-studio-brain-ops-session": String(portalModel.sessionToken) };
        const sessionMeResponse = await fetch(`${baseUrl}/api/ops/session/me`, {
            headers: sessionHeaders,
        });
        strict_1.default.equal(sessionMeResponse.status, 200);
        const sessionMePayload = (await sessionMeResponse.json());
        strict_1.default.equal(sessionMePayload.ok, true);
        strict_1.default.equal(sessionMePayload.session.actorId, "staff-test-uid");
        const memberDetailResponse = await fetch(`${baseUrl}/api/ops/members/member-1`, {
            headers: sessionHeaders,
        });
        strict_1.default.equal(memberDetailResponse.status, 200);
        const memberActivityResponse = await fetch(`${baseUrl}/api/ops/members/member-1/activity`, {
            headers: sessionHeaders,
        });
        strict_1.default.equal(memberActivityResponse.status, 200);
        const choiceResponse = await fetch(`${baseUrl}/ops/choice`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(choiceResponse.status, 200);
        const choiceHtml = await choiceResponse.text();
        strict_1.default.ok(choiceHtml.includes("Legacy staff experience"));
        strict_1.default.ok(choiceHtml.includes("Autonomous Studio OS"));
    });
});
(0, node_test_1.default)("ops staff replacement routes expose session context and member management flows", async () => {
    const store = new store_1.MemoryOpsStore();
    let member = {
        uid: "member-1",
        email: "member@example.com",
        displayName: "Studio Member",
        membershipTier: "drop-in",
        kilnPreferences: "Cone 6 preferred",
        staffNotes: "Prefers pickup texts.",
        billing: null,
        portalRole: "member",
        opsRoles: [],
        opsCapabilities: [],
        createdAt: "2026-04-17T00:00:00.000Z",
        updatedAt: "2026-04-17T00:00:00.000Z",
        lastSeenAt: "2026-04-16T20:00:00.000Z",
        metadata: {},
    };
    const opsService = (0, service_1.createOpsService)({
        store,
        staffDataSource: {
            async listMembers() { return [member]; },
            async getMember(uid) { return uid === member.uid ? member : null; },
            async createMember(input) {
                member = {
                    ...member,
                    uid: "member-2",
                    email: input.email,
                    displayName: input.displayName,
                    membershipTier: input.membershipTier ?? null,
                    staffNotes: input.staffNotes ?? null,
                    portalRole: input.portalRole ?? "member",
                    opsRoles: input.opsRoles ?? [],
                    updatedAt: "2026-04-17T01:55:00.000Z",
                };
                return {
                    member: member,
                    created: {
                        uid: member.uid,
                        email: input.email,
                        displayName: input.displayName,
                        membershipTier: input.membershipTier ?? null,
                        portalRole: input.portalRole ?? "member",
                        opsRoles: input.opsRoles ?? [],
                        reason: input.reason ?? null,
                        createdAt: "2026-04-17T01:55:00.000Z",
                    },
                    audit: {
                        id: "audit-create-route",
                        uid: "member-2",
                        kind: "create",
                        actorId: input.actorId,
                        summary: "Member created.",
                        reason: input.reason ?? null,
                        createdAt: "2026-04-17T01:55:00.000Z",
                        payload: { email: input.email },
                    },
                };
            },
            async updateMemberProfile(input) {
                member = {
                    ...member,
                    displayName: input.patch.displayName ?? member.displayName,
                    kilnPreferences: input.patch.kilnPreferences ?? member.kilnPreferences,
                    staffNotes: input.patch.staffNotes ?? member.staffNotes,
                    updatedAt: "2026-04-17T02:00:00.000Z",
                };
                return {
                    member: member,
                    audit: {
                        id: "audit-profile-route",
                        uid: member.uid,
                        kind: "profile",
                        actorId: input.actorId,
                        summary: "Profile updated.",
                        reason: input.reason ?? null,
                        createdAt: "2026-04-17T02:00:00.000Z",
                        payload: input.patch,
                    },
                };
            },
            async updateMemberBilling(input) {
                member = {
                    ...member,
                    billing: {
                        stripeCustomerId: input.billing.stripeCustomerId ?? null,
                        defaultPaymentMethodId: input.billing.defaultPaymentMethodId ?? null,
                        cardBrand: input.billing.cardBrand ?? null,
                        cardLast4: input.billing.cardLast4 ?? null,
                        expMonth: input.billing.expMonth ?? null,
                        expYear: input.billing.expYear ?? null,
                        paymentMethodSummary: "Visa · •••• 4242 · exp 08/2030",
                        billingContactName: input.billing.billingContactName ?? null,
                        billingContactEmail: input.billing.billingContactEmail ?? null,
                        billingContactPhone: input.billing.billingContactPhone ?? null,
                        storageMode: "stripe_tokenized_only",
                        updatedAt: "2026-04-17T02:03:00.000Z",
                    },
                    updatedAt: "2026-04-17T02:03:00.000Z",
                };
                return {
                    member: member,
                    audit: {
                        id: "audit-billing-route",
                        uid: member.uid,
                        kind: "billing",
                        actorId: input.actorId,
                        summary: "Billing updated.",
                        reason: input.reason ?? null,
                        createdAt: "2026-04-17T02:03:00.000Z",
                        payload: input.billing,
                    },
                };
            },
            async updateMemberMembership(input) {
                member = {
                    ...member,
                    membershipTier: input.membershipTier,
                    updatedAt: "2026-04-17T02:05:00.000Z",
                };
                return {
                    member: member,
                    audit: {
                        id: "audit-membership-route",
                        uid: member.uid,
                        editedByUid: input.actorId,
                        beforeTier: "drop-in",
                        afterTier: input.membershipTier,
                        reason: input.reason ?? null,
                        createdAt: "2026-04-17T02:05:00.000Z",
                        summary: "Membership updated.",
                    },
                };
            },
            async updateMemberRole(input) {
                member = {
                    ...member,
                    portalRole: input.portalRole,
                    opsRoles: input.opsRoles,
                    updatedAt: "2026-04-17T02:10:00.000Z",
                };
                return {
                    member: member,
                    audit: {
                        id: "audit-role-route",
                        uid: member.uid,
                        editedByUid: input.actorId,
                        beforePortalRole: "member",
                        afterPortalRole: input.portalRole,
                        beforeOpsRoles: [],
                        afterOpsRoles: input.opsRoles,
                        reason: input.reason ?? null,
                        createdAt: "2026-04-17T02:10:00.000Z",
                        summary: "Role updated.",
                    },
                };
            },
            async getMemberActivity(uid) {
                return {
                    uid,
                    reservations: 1,
                    libraryLoans: 0,
                    supportThreads: 1,
                    events: 2,
                    lastReservationAt: member.lastSeenAt,
                    lastLoanAt: null,
                    lastEventAt: member.lastSeenAt,
                };
            },
            async listReservations() { return []; },
            async getReservationBundle() { return null; },
            async listEvents() { return []; },
            async listReports() { return []; },
            async getLendingSnapshot() {
                return {
                    requests: [],
                    loans: [],
                    recommendationCount: 0,
                    tagSubmissionCount: 0,
                    coverReviewCount: 0,
                    generatedAt: "2026-04-17T00:00:00.000Z",
                };
            },
        },
    });
    await withServer({
        opsService,
        opsPortalConfig: {
            enabled: true,
            requireStaffAuth: true,
        },
        adminToken: "test-ops-session-secret",
    }, async (baseUrl) => {
        const sessionResponse = await fetch(`${baseUrl}/api/ops/session/me`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(sessionResponse.status, 200);
        const sessionPayload = (await sessionResponse.json());
        strict_1.default.equal(sessionPayload.ok, true);
        strict_1.default.equal(sessionPayload.session.actorId, "staff-test-uid");
        strict_1.default.ok(sessionPayload.session.allowedSurfaces.includes("internet"));
        strict_1.default.ok(sessionPayload.session.allowedModes.internet.includes("member-ops"));
        const membersResponse = await fetch(`${baseUrl}/api/ops/members`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(membersResponse.status, 200);
        const membersPayload = (await membersResponse.json());
        strict_1.default.equal(membersPayload.ok, true);
        strict_1.default.equal(membersPayload.rows[0]?.uid, "member-1");
        const createResponse = await fetch(`${baseUrl}/api/ops/members`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                email: "newmember@example.com",
                displayName: "New Member",
                membershipTier: "community",
                reason: "Create route test.",
            }),
        });
        strict_1.default.equal(createResponse.status, 200);
        const createPayload = (await createResponse.json());
        strict_1.default.equal(createPayload.ok, true);
        strict_1.default.equal(createPayload.member.uid, "member-2");
        const membershipResponse = await fetch(`${baseUrl}/api/ops/members/member-1/membership`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                membershipTier: "community",
                reason: "Route-level update test.",
            }),
        });
        strict_1.default.equal(membershipResponse.status, 200);
        const membershipPayload = (await membershipResponse.json());
        strict_1.default.equal(membershipPayload.ok, true);
        strict_1.default.equal(membershipPayload.member.membershipTier, "community");
        const billingResponse = await fetch(`${baseUrl}/api/ops/members/member-2/billing`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                reason: "Billing route test.",
                billing: {
                    stripeCustomerId: "cus_123",
                    defaultPaymentMethodId: "pm_123",
                    cardBrand: "Visa",
                    cardLast4: "4242",
                    expMonth: "08",
                    expYear: "2030",
                    billingContactEmail: "billing@example.com",
                },
            }),
        });
        strict_1.default.equal(billingResponse.status, 200);
        const billingPayload = (await billingResponse.json());
        strict_1.default.equal(billingPayload.ok, true);
        strict_1.default.equal(billingPayload.member.billing?.stripeCustomerId, "cus_123");
        strict_1.default.equal(billingPayload.member.billing?.cardLast4, "4242");
        const rawCardRejected = await fetch(`${baseUrl}/api/ops/members/member-2/billing`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                billing: {
                    cardNumber: "4242424242424242",
                },
            }),
        });
        strict_1.default.equal(rawCardRejected.status, 400);
        const activityResponse = await fetch(`${baseUrl}/api/ops/members/member-1/activity`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(activityResponse.status, 200);
        const activityPayload = (await activityResponse.json());
        strict_1.default.equal(activityPayload.ok, true);
        strict_1.default.equal(activityPayload.activity.reservations, 1);
        strict_1.default.equal(activityPayload.activity.supportThreads, 1);
        const portalResponse = await fetch(`${baseUrl}/ops?surface=internet&mode=member-ops`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(portalResponse.status, 200);
        const portalHtml = await portalResponse.text();
        strict_1.default.ok(portalHtml.includes('id="ops-member-workbench"'));
        strict_1.default.ok(portalHtml.includes('id="ops-member-create-trigger"'));
        strict_1.default.ok(portalHtml.includes('data-viewport-toggle="single-screen"'));
        strict_1.default.ok(portalHtml.includes("Never type raw card numbers here"));
        strict_1.default.ok(portalHtml.includes("Roster and onboarding"));
        strict_1.default.ok(portalHtml.includes("One member, one intent"));
        strict_1.default.ok(portalHtml.includes('class="ops-shell"'));
        strict_1.default.ok(!portalHtml.includes('window.prompt("Display name"'));
        strict_1.default.ok(!portalHtml.includes('window.prompt("Membership tier"'));
        strict_1.default.ok(!portalHtml.includes('window.prompt("Comma-separated ops roles"'));
    });
});
(0, node_test_1.default)("ops portal can be disabled independently from the rest of the server", async () => {
    const opsService = (0, service_1.createOpsService)({ store: new store_1.MemoryOpsStore() });
    await withServer({
        opsService,
        opsPortalConfig: {
            enabled: false,
        },
    }, async (baseUrl) => {
        const portalResponse = await fetch(`${baseUrl}/ops`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(portalResponse.status, 404);
        const twinResponse = await fetch(`${baseUrl}/api/ops/twin`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(twinResponse.status, 404);
    });
});
(0, node_test_1.default)("ops ingest endpoint accepts signed events and dedupes repeated source ids", async () => {
    const secret = "ops-secret";
    const opsService = (0, service_1.createOpsService)({ store: new store_1.MemoryOpsStore() });
    const payload = {
        sourceSystem: "kilnaid",
        eventType: "kiln.run_status_changed",
        entityKind: "kiln",
        entityId: "kiln-1",
        sourceEventId: "evt-ops-1",
        actorKind: "machine",
        actorId: "kilnaid-bridge",
        payload: { phase: "ready_for_unload" },
    };
    await withServer({
        opsService,
        opsIngestConfig: {
            enabled: true,
            hmacSecret: secret,
            allowedSources: ["kilnaid"],
            maxSkewSeconds: 300,
        },
        opsPortalConfig: {
            enabled: true,
        },
    }, async (baseUrl) => {
        const first = await fetch(`${baseUrl}/api/ops/events/ingest`, {
            method: "POST",
            headers: buildOpsIngestHeaders(secret, payload),
            body: JSON.stringify(payload),
        });
        strict_1.default.equal(first.status, 202);
        const firstPayload = (await first.json());
        strict_1.default.equal(firstPayload.ok, true);
        strict_1.default.equal(firstPayload.accepted, true);
        const second = await fetch(`${baseUrl}/api/ops/events/ingest`, {
            method: "POST",
            headers: buildOpsIngestHeaders(secret, payload),
            body: JSON.stringify(payload),
        });
        strict_1.default.equal(second.status, 200);
        const secondPayload = (await second.json());
        strict_1.default.equal(secondPayload.ok, true);
        strict_1.default.equal(secondPayload.accepted, false);
    });
});
(0, node_test_1.default)("handler failure returns 500 without crashing server", async () => {
    const stateStore = new memoryStores_1.MemoryStateStore();
    const badStateStore = stateStore;
    badStateStore.getLatestStudioState = async () => {
        throw new Error("boom");
    };
    await withServer({
        stateStore: badStateStore,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/studio-state/latest`);
        const payload = (await response.json());
        strict_1.default.equal(response.status, 500);
        strict_1.default.equal(payload.ok, false);
        strict_1.default.equal(payload.message, "Internal server error");
    });
});
(0, node_test_1.default)("capability workflow enforces approval before execution", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(created.status, 201);
        const createdPayload = (await created.json());
        strict_1.default.equal(createdPayload.proposal.requestedBy, "staff-test-uid");
        const proposalId = createdPayload.proposal.id;
        const denied = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "would close" },
            }),
        });
        strict_1.default.equal(denied.status, 409);
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                approvedBy: "staff-approver",
                rationale: "Approved after staff review and compliance verification.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const executed = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "closed" },
            }),
        });
        strict_1.default.equal(executed.status, 200);
        const executedPayload = (await executed.json());
        strict_1.default.equal(executedPayload.proposal.status, "executed");
    });
});
(0, node_test_1.default)("quota endpoints list and reset buckets", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "hubitat.devices.read",
                rationale: "Read-only status refresh for dashboard health tiles.",
                previewSummary: "Read connector status",
                requestInput: { deviceId: "hub-7" },
                expectedEffects: ["No external writes."],
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "ok" },
            }),
        });
        const listed = await fetch(`${baseUrl}/api/capabilities/quotas`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(listed.status, 200);
        const listedPayload = (await listed.json());
        strict_1.default.ok(listedPayload.buckets.length >= 1);
        const targetBucket = listedPayload.buckets[0].bucket;
        const reset = await fetch(`${baseUrl}/api/capabilities/quotas/${encodeURIComponent(targetBucket)}/reset`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({ reason: "Emergency counter reset during incident triage." }),
        });
        strict_1.default.equal(reset.status, 200);
    });
});
(0, node_test_1.default)("capability audit endpoint returns filtered capability events", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "hubitat.devices.read",
                rationale: "Read-only status refresh for dashboard health tiles.",
                previewSummary: "Read connector status",
                requestInput: { deviceId: "hub-7" },
                expectedEffects: ["No external writes."],
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "ok" },
            }),
        });
        const auditResp = await fetch(`${baseUrl}/api/capabilities/audit?limit=20`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(auditResp.status, 200);
        const payload = (await auditResp.json());
        strict_1.default.ok(payload.rows.length >= 1);
        strict_1.default.ok(payload.rows.every((row) => row.action.startsWith("capability.")));
        const filtered = await fetch(`${baseUrl}/api/capabilities/audit?limit=20&actionPrefix=capability.hubitat.devices.read`, { headers: { authorization: "Bearer test-staff" } });
        strict_1.default.equal(filtered.status, 200);
        const filteredPayload = (await filtered.json());
        strict_1.default.ok(filteredPayload.rows.length >= 1);
        strict_1.default.ok(filteredPayload.rows.every((row) => row.action.startsWith("capability.hubitat.devices.read")));
    });
});
(0, node_test_1.default)("capability audit export endpoint returns verifiable bundle", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Export seed proposal for audit verification checks.",
                previewSummary: "Seed export",
                requestInput: { batchId: "mfb-1" },
                expectedEffects: ["none"],
            }),
        });
        strict_1.default.equal(created.status, 201);
        const response = await fetch(`${baseUrl}/api/capabilities/audit/export?limit=50`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(payload.bundle.manifest.rowCount >= 1);
        strict_1.default.ok(payload.bundle.manifest.payloadHash.length > 10);
    });
});
(0, node_test_1.default)("quota reset requires a reason", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities/quotas/missing/reset`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        strict_1.default.equal(response.status, 400);
    });
});
(0, node_test_1.default)("approval and rejection endpoints require rationale", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        const missingApproveRationale = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        strict_1.default.equal(missingApproveRationale.status, 400);
        const missingRejectRationale = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reject`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({}),
        });
        strict_1.default.equal(missingRejectRationale.status, 400);
    });
});
(0, node_test_1.default)("kill switch blocks execution even for approved proposal", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                rationale: "Approved after staff review and compliance verification.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const killSwitchOn = await fetch(`${baseUrl}/api/capabilities/policy/kill-switch`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                enabled: true,
                rationale: "Emergency freeze while policy behavior is validated.",
            }),
        });
        strict_1.default.equal(killSwitchOn.status, 200);
        const executeBlocked = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                output: { result: "closed" },
            }),
        });
        strict_1.default.equal(executeBlocked.status, 409);
        const payload = (await executeBlocked.json());
        strict_1.default.equal(payload.decision.reasonCode, "BLOCKED_BY_POLICY");
    });
});
(0, node_test_1.default)("capability endpoints require admin token when configured", async () => {
    await withServer({
        adminToken: "secret-token",
        allowedOrigins: ["http://127.0.0.1:5173"],
    }, async (baseUrl) => {
        const preflight = await fetch(`${baseUrl}/api/capabilities`, {
            method: "OPTIONS",
            headers: { Origin: "http://127.0.0.1:5173" },
        });
        strict_1.default.equal(preflight.status, 204);
        const unauthorized = await fetch(`${baseUrl}/api/capabilities`, {
            method: "GET",
            headers: { Origin: "http://127.0.0.1:5173", authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(unauthorized.status, 401);
        const authorized = await fetch(`${baseUrl}/api/capabilities`, {
            method: "GET",
            headers: {
                Origin: "http://127.0.0.1:5173",
                authorization: "Bearer test-staff",
                "x-studio-brain-admin-token": "secret-token",
            },
        });
        strict_1.default.equal(authorized.status, 200);
    });
});
(0, node_test_1.default)("capability endpoints reject non-staff principal", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities`, {
            method: "GET",
            headers: { authorization: "Bearer test-member" },
        });
        strict_1.default.equal(response.status, 401);
    });
});
(0, node_test_1.default)("capability policy lint endpoint returns lint status", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities/policy-lint`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(payload.capabilitiesChecked >= 1);
        strict_1.default.ok(Array.isArray(payload.violations));
    });
});
(0, node_test_1.default)("connector health endpoint returns connector rows", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/connectors/health`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.ok(Array.isArray(payload.connectors));
    });
});
(0, node_test_1.default)("proposal endpoint rejects agent actor without delegation", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(response.status, 403);
        const payload = (await response.json());
        strict_1.default.equal(payload.reasonCode, "DELEGATION_MISSING");
    });
});
(0, node_test_1.default)("proposal and execute allow agent actor with valid delegation", async () => {
    await withServer({}, async (baseUrl) => {
        const create = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-1",
                ownerUid: "owner-1",
                delegation: {
                    delegationId: "del-1",
                    agentUid: "agent-1",
                    ownerUid: "owner-1",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(create.status, 201);
        const createdPayload = (await create.json());
        const proposalId = createdPayload.proposal.id;
        await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                rationale: "Approved after staff review and compliance verification.",
            }),
        });
        const execute = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-1",
                ownerUid: "owner-1",
                delegation: {
                    delegationId: "del-1",
                    agentUid: "agent-1",
                    ownerUid: "owner-1",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                output: { result: "closed" },
            }),
        });
        strict_1.default.equal(execute.status, 200);
    });
});
(0, node_test_1.default)("ops recommendation drafts endpoint returns detector drafts", async () => {
    const eventStore = new memoryStores_1.MemoryEventStore();
    await eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: "studio_ops.recommendation_draft_created",
        rationale: "Agent requests pending is 24 (delta +10).",
        target: "local",
        approvalState: "exempt",
        inputHash: "in-hash",
        outputHash: "out-hash",
        metadata: {
            ruleId: "queue_spike",
            severity: "medium",
            title: "Agent request queue spike",
            recommendation: "Triage queue.",
            snapshotDate: "2026-02-13",
        },
    });
    await withServer({
        eventStore,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/ops/recommendations/drafts?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.rows.length, 1);
        strict_1.default.equal(payload.rows[0].ruleId, "queue_spike");
    });
});
(0, node_test_1.default)("marketing drafts endpoint lists drafts and review updates status", async () => {
    const eventStore = new memoryStores_1.MemoryEventStore();
    await eventStore.append({
        actorType: "system",
        actorId: "studio-brain",
        action: "studio_marketing.draft_created",
        rationale: "Generated instagram draft from StudioState snapshot.",
        target: "local",
        approvalState: "exempt",
        inputHash: "in-hash",
        outputHash: "out-hash",
        metadata: {
            draftId: "mk-2026-02-13-ig",
            status: "draft",
            channel: "instagram",
            title: "Studio Pulse Update",
            copy: "copy",
            sourceSnapshotDate: "2026-02-13",
            sourceRefs: ["ops.agentRequestsPending=1"],
            confidenceNotes: "notes",
            templateVersion: "marketing-v1",
        },
    });
    await withServer({ eventStore }, async (baseUrl) => {
        const listed = await fetch(`${baseUrl}/api/marketing/drafts?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(listed.status, 200);
        const listedPayload = (await listed.json());
        strict_1.default.equal(listedPayload.rows[0].draftId, "mk-2026-02-13-ig");
        strict_1.default.equal(listedPayload.rows[0].status, "draft");
        const review = await fetch(`${baseUrl}/api/marketing/drafts/mk-2026-02-13-ig/review`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({
                toStatus: "needs_review",
                rationale: "Reviewed for tone and content alignment before publish queue.",
            }),
        });
        strict_1.default.equal(review.status, 200);
    });
});
(0, node_test_1.default)("finance reconciliation drafts endpoint returns finance drafts", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/finance/reconciliation/drafts?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.ok(Array.isArray(payload.rows));
    });
});
(0, node_test_1.default)("ops drills endpoint records drill events", async () => {
    await withServer({}, async (baseUrl) => {
        const post = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                scenarioId: "token_compromise",
                status: "started",
                outcome: "in_progress",
                notes: "Chaos drill start.",
            }),
        });
        strict_1.default.equal(post.status, 200);
        const list = await fetch(`${baseUrl}/api/ops/drills?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(list.status, 200);
        const payload = (await list.json());
        strict_1.default.ok(payload.rows.some((row) => row.scenarioId === "token_compromise"));
    });
});
(0, node_test_1.default)("ops drills endpoint enforces auth and required drill fields", async () => {
    await withServer({}, async (baseUrl) => {
        const unauthorized = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                scenarioId: "connector_outage",
                status: "started",
            }),
        });
        strict_1.default.equal(unauthorized.status, 401);
        const missingScenario = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                status: "started",
            }),
        });
        strict_1.default.equal(missingScenario.status, 400);
        const missingStatus = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                scenarioId: "connector_outage",
            }),
        });
        strict_1.default.equal(missingStatus.status, 400);
        const nonStaff = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-member" },
            body: JSON.stringify({
                scenarioId: "connector_outage",
                status: "started",
            }),
        });
        strict_1.default.equal(nonStaff.status, 401);
    });
});
(0, node_test_1.default)("ops drills endpoint preserves mttr and unresolved risk metadata", async () => {
    await withServer({}, async (baseUrl) => {
        const posted = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                scenarioId: "policy_bypass_attempt",
                status: "completed",
                outcome: "partial",
                notes: "Kill switch blocked writes; one stale alert remained.",
                mttrMinutes: 42,
                unresolvedRisks: ["alert-routing-followup", "playbook-clarification"],
            }),
        });
        strict_1.default.equal(posted.status, 200);
        const list = await fetch(`${baseUrl}/api/ops/drills?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(list.status, 200);
        const payload = (await list.json());
        const row = payload.rows.find((entry) => entry.scenarioId === "policy_bypass_attempt");
        strict_1.default.ok(row);
        strict_1.default.equal(row?.status, "completed");
        strict_1.default.equal(row?.outcome, "partial");
        strict_1.default.equal(row?.mttrMinutes, 42);
        strict_1.default.deepEqual(row?.unresolvedRisks ?? [], ["alert-routing-followup", "playbook-clarification"]);
    });
});
(0, node_test_1.default)("ops drills endpoint events are queryable in ops audit stream", async () => {
    await withServer({}, async (baseUrl) => {
        const post = await fetch(`${baseUrl}/api/ops/drills`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                scenarioId: "connector_outage",
                status: "completed",
                outcome: "success",
                notes: "Connector timeout storm drill completed.",
            }),
        });
        strict_1.default.equal(post.status, 200);
        const audit = await fetch(`${baseUrl}/api/ops/audit?limit=20&actionPrefix=studio_ops.drill_event`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(audit.status, 200);
        const payload = (await audit.json());
        const row = payload.rows.find((entry) => entry.action === "studio_ops.drill_event");
        strict_1.default.ok(row);
        strict_1.default.equal(row?.metadata?.scenarioId, "connector_outage");
        strict_1.default.equal(row?.metadata?.status, "completed");
        strict_1.default.equal(row?.metadata?.outcome, "success");
    });
});
(0, node_test_1.default)("ops degraded endpoint records entry and audit list returns events", async () => {
    await withServer({}, async (baseUrl) => {
        const post = await fetch(`${baseUrl}/api/ops/degraded`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                status: "entered",
                mode: "offline",
                reason: "Studio Brain not reachable from staff console.",
            }),
        });
        strict_1.default.equal(post.status, 200);
        const list = await fetch(`${baseUrl}/api/ops/audit?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(list.status, 200);
        const payload = (await list.json());
        strict_1.default.ok(payload.rows.some((row) => row.action === "studio_ops.degraded_mode_entered"));
    });
});
(0, node_test_1.default)("pilot dry-run endpoint returns plan for approved pilot capability", async () => {
    const pilotExecutor = {
        dryRun: () => ({
            actionType: "ops_note_append",
            ownerUid: "owner-1",
            resourceCollection: "batches",
            resourceId: "batch-1",
            notePreview: "preview",
        }),
        execute: async () => ({
            idempotencyKey: "k",
            proposalId: "p",
            replayed: false,
            resourcePointer: { collection: "studioBrainPilotOpsNotes", docId: "note-1" },
        }),
        rollback: async () => ({ ok: true, replayed: false }),
    };
    await withServer({ pilotWriteExecutor: pilotExecutor }, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                capabilityId: "firestore.ops_note.append",
                rationale: "Pilot dry-run before execution with bounded Firestore write.",
                previewSummary: "Pilot dry run",
                requestInput: {
                    actionType: "ops_note_append",
                    ownerUid: "owner-1",
                    resourceCollection: "batches",
                    resourceId: "batch-1",
                    note: "Sample note",
                },
                expectedEffects: ["No write on dry run."],
                requestedBy: "staff-test-uid",
            }),
        });
        const payload = (await created.json());
        const proposalId = String(payload.proposal?.id ?? "");
        const dryRun = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/dry-run`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(dryRun.status, 200);
    });
});
(0, node_test_1.default)("high-risk agent intake is blocked and routed to manual review", async () => {
    await withServer({}, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-1",
                ownerUid: "owner-1",
                delegation: {
                    delegationId: "del-1",
                    agentUid: "agent-risk-1",
                    ownerUid: "owner-1",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Create an exact replica disney logo piece and bypass checks.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(response.status, 403);
        const payload = (await response.json());
        strict_1.default.equal(payload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
        strict_1.default.ok(payload.intakeId.length > 5);
        const queue = await fetch(`${baseUrl}/api/intake/review-queue?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(queue.status, 200);
        const queuePayload = (await queue.json());
        strict_1.default.ok(queuePayload.rows.length >= 1);
        strict_1.default.equal(queuePayload.rows[0].category, "ip_infringement");
    });
});
(0, node_test_1.default)("staff override granted allows previously blocked agent intake", async () => {
    await withServer({}, async (baseUrl) => {
        const createBlocked = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-2",
                ownerUid: "owner-2",
                delegation: {
                    delegationId: "del-2",
                    agentUid: "agent-risk-2",
                    ownerUid: "owner-2",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Need exact replica disney logo piece for customer.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        const blockedPayload = (await createBlocked.json());
        strict_1.default.equal(createBlocked.status, 403);
        const grant = await fetch(`${baseUrl}/api/intake/review-queue/${blockedPayload.intakeId}/override`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({
                decision: "override_granted",
                reasonCode: "staff_override_context_verified",
                rationale: "Staff verified rights documentation and approved exception path.",
            }),
        });
        strict_1.default.equal(grant.status, 200);
        const createAllowed = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-2",
                ownerUid: "owner-2",
                delegation: {
                    delegationId: "del-2",
                    agentUid: "agent-risk-2",
                    ownerUid: "owner-2",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Need exact replica disney logo piece for customer.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(createAllowed.status, 201);
    });
});
(0, node_test_1.default)("ops degraded endpoint enforces auth and validates status values", async () => {
    await withServer({}, async (baseUrl) => {
        const nonStaff = await fetch(`${baseUrl}/api/ops/degraded`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-member" },
            body: JSON.stringify({
                status: "entered",
                mode: "offline",
            }),
        });
        strict_1.default.equal(nonStaff.status, 401);
        const invalidStatus = await fetch(`${baseUrl}/api/ops/degraded`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                status: "paused",
                mode: "offline",
            }),
        });
        strict_1.default.equal(invalidStatus.status, 400);
    });
});
(0, node_test_1.default)("ops degraded endpoint preserves mode metadata and supports audit prefix filtering", async () => {
    await withServer({}, async (baseUrl) => {
        const entered = await fetch(`${baseUrl}/api/ops/degraded`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                status: "entered",
                mode: "offline",
                reason: "Studio Brain unavailable during connector outage drill.",
                details: "Switched staff console to cloud-only fallback.",
            }),
        });
        strict_1.default.equal(entered.status, 200);
        const exited = await fetch(`${baseUrl}/api/ops/degraded`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                status: "exited",
                mode: "offline",
                reason: "Recovered after restart.",
                details: "Restored normal studio-brain routing.",
            }),
        });
        strict_1.default.equal(exited.status, 200);
        const audit = await fetch(`${baseUrl}/api/ops/audit?limit=20&actionPrefix=studio_ops.degraded_mode_`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(audit.status, 200);
        const payload = (await audit.json());
        const enteredRow = payload.rows.find((row) => row.action === "studio_ops.degraded_mode_entered");
        const exitedRow = payload.rows.find((row) => row.action === "studio_ops.degraded_mode_exited");
        strict_1.default.ok(enteredRow);
        strict_1.default.ok(exitedRow);
        strict_1.default.equal(enteredRow?.metadata?.status, "entered");
        strict_1.default.equal(exitedRow?.metadata?.status, "exited");
        strict_1.default.equal(enteredRow?.metadata?.mode, "offline");
    });
});
(0, node_test_1.default)("ops audit and ops drills listing endpoints reject non-staff principals", async () => {
    await withServer({}, async (baseUrl) => {
        const audit = await fetch(`${baseUrl}/api/ops/audit?limit=10`, {
            headers: { authorization: "Bearer test-member" },
        });
        strict_1.default.equal(audit.status, 401);
        const drills = await fetch(`${baseUrl}/api/ops/drills?limit=10`, {
            headers: { authorization: "Bearer test-member" },
        });
        strict_1.default.equal(drills.status, 401);
    });
});
(0, node_test_1.default)("staff override denied keeps blocked intake denied on retry", async () => {
    await withServer({}, async (baseUrl) => {
        const createBlocked = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-3",
                ownerUid: "owner-3",
                delegation: {
                    delegationId: "del-3",
                    agentUid: "agent-risk-3",
                    ownerUid: "owner-3",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Need exact replica disney logo for a rush order.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(createBlocked.status, 403);
        const blockedPayload = (await createBlocked.json());
        strict_1.default.equal(blockedPayload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
        strict_1.default.ok(blockedPayload.intakeId.length > 5);
        const deny = await fetch(`${baseUrl}/api/intake/review-queue/${blockedPayload.intakeId}/override`, {
            method: "POST",
            headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
            body: JSON.stringify({
                decision: "override_denied",
                reasonCode: "policy_confirmed_block",
                rationale: "Staff denied request because rights proof is missing.",
            }),
        });
        strict_1.default.equal(deny.status, 200);
        const createStillBlocked = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "agent",
                actorId: "agent-risk-3",
                ownerUid: "owner-3",
                delegation: {
                    delegationId: "del-3",
                    agentUid: "agent-risk-3",
                    ownerUid: "owner-3",
                    scopes: ["capability:firestore.batch.close:execute"],
                    expiresAt: "2099-01-01T00:00:00.000Z",
                },
                capabilityId: "firestore.batch.close",
                rationale: "Need exact replica disney logo for a rush order.",
                previewSummary: "replica trademark commission",
                requestInput: { note: "disney exact logo" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(createStillBlocked.status, 403);
        const stillBlockedPayload = (await createStillBlocked.json());
        strict_1.default.equal(stillBlockedPayload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
    });
});
(0, node_test_1.default)("trust safety triage suggestion endpoints generate and track feedback", async () => {
    await withServer({}, async (baseUrl) => {
        const suggest = await fetch(`${baseUrl}/api/trust-safety/triage/suggest`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                reportId: "report-1",
                targetType: "blog_post",
                targetTitle: "Safety notice",
                note: "This contains threat language and possible self-harm hints.",
            }),
        });
        strict_1.default.equal(suggest.status, 200);
        const suggestPayload = (await suggest.json());
        strict_1.default.equal(suggestPayload.suggestion.suggestionOnly, true);
        strict_1.default.equal(suggestPayload.suggestion.category, "safety");
        const feedback = await fetch(`${baseUrl}/api/trust-safety/triage/feedback`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                reportId: "report-1",
                decision: "accepted",
                mismatch: false,
                suggestedSeverity: "high",
                suggestedCategory: "safety",
                suggestedReasonCode: "safety_escalated",
                finalSeverity: "high",
                finalCategory: "safety",
                finalReasonCode: "safety_escalated",
            }),
        });
        strict_1.default.equal(feedback.status, 200);
        const stats = await fetch(`${baseUrl}/api/trust-safety/triage/stats?limit=100`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(stats.status, 200);
        const statsPayload = (await stats.json());
        strict_1.default.equal(statsPayload.stats.accepted, 1);
        strict_1.default.equal(statsPayload.stats.rejected, 0);
    });
});
(0, node_test_1.default)("proposal endpoint returns 429 when endpoint throttle exceeded and logs rate-limit event", async () => {
    await withServer({
        endpointRateLimits: { createProposalPerMinute: 1 },
    }, async (baseUrl) => {
        const first = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "hubitat.devices.read",
                rationale: "Read-only status refresh for dashboard health tiles.",
                previewSummary: "Read connector status",
                requestInput: { deviceId: "hub-7" },
                expectedEffects: ["No external writes."],
            }),
        });
        strict_1.default.equal(first.status, 201);
        const second = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "hubitat.devices.read",
                rationale: "Read-only status refresh for dashboard health tiles.",
                previewSummary: "Read connector status",
                requestInput: { deviceId: "hub-7" },
                expectedEffects: ["No external writes."],
            }),
        });
        strict_1.default.equal(second.status, 429);
        const payload = (await second.json());
        strict_1.default.equal(payload.reasonCode, "RATE_LIMITED");
        strict_1.default.ok(payload.retryAfterSeconds > 0);
        const eventsResp = await fetch(`${baseUrl}/api/capabilities/rate-limits/events?limit=10`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(eventsResp.status, 200);
        const eventsPayload = (await eventsResp.json());
        strict_1.default.ok(eventsPayload.rows.length >= 1);
        strict_1.default.ok(eventsPayload.rows.every((row) => row.action === "rate_limit_triggered"));
    });
});
(0, node_test_1.default)("reopen rejected proposal requires admin role", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Close this batch after final QA pass completes.",
                previewSummary: "Close batch mfb-123",
                requestInput: { batchId: "mfb-123" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        const payload = (await created.json());
        const proposalId = payload.proposal.id;
        await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reject`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({ reason: "Policy mismatch in final review." }),
        });
        const forbidden = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reopen`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({ reason: "Need another review pass with updated context." }),
        });
        strict_1.default.equal(forbidden.status, 403);
        const reopened = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reopen`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-admin" },
            body: JSON.stringify({ reason: "Need another review pass with updated context." }),
        });
        strict_1.default.equal(reopened.status, 200);
        const reopenedPayload = (await reopened.json());
        strict_1.default.equal(reopenedPayload.proposal.status, "pending_approval");
    });
});
(0, node_test_1.default)("pilot write executes only after approval and supports replay semantics", async () => {
    const idempotencySeen = new Set();
    const pilotExecutor = {
        dryRun: (input) => ({
            actionType: "ops_note_append",
            ownerUid: String(input.ownerUid ?? "owner-1"),
            resourceCollection: "batches",
            resourceId: String(input.resourceId ?? "batch-1"),
            notePreview: String(input.note ?? ""),
        }),
        execute: async (input) => ({
            idempotencyKey: input.idempotencyKey,
            proposalId: input.proposalId,
            replayed: idempotencySeen.has(input.idempotencyKey),
            resourcePointer: {
                collection: "studioBrainPilotOpsNotes",
                docId: "note-1",
            },
        }),
        rollback: async () => ({ ok: true, replayed: false }),
    };
    await withServer({ pilotWriteExecutor: pilotExecutor }, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                capabilityId: "firestore.ops_note.append",
                rationale: "Pilot append note after approved ops review.",
                previewSummary: "Append note",
                requestInput: {
                    actionType: "ops_note_append",
                    ownerUid: "owner-1",
                    resourceCollection: "batches",
                    resourceId: "batch-1",
                    note: "Dry rack moved; verify glaze consistency.",
                },
                expectedEffects: ["Add staff-visible note for ops context."],
                requestedBy: "staff-test-uid",
            }),
        });
        strict_1.default.ok(created.status === 200 || created.status === 201);
        const createdPayload = (await created.json());
        const proposalId = String(createdPayload.proposal?.id ?? "");
        strict_1.default.ok(proposalId.length > 0);
        const deniedBeforeApproval = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                idempotencyKey: "pilot-key-001",
                output: {},
            }),
        });
        strict_1.default.equal(deniedBeforeApproval.status, 409);
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                approvedBy: "staff-test-uid",
                rationale: "Approved for low-risk pilot note write.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const firstExecute = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                idempotencyKey: "pilot-key-001",
                output: {},
            }),
        });
        strict_1.default.equal(firstExecute.status, 200);
        idempotencySeen.add("pilot-key-001");
        const replay = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                idempotencyKey: "pilot-key-001",
                output: {},
            }),
        });
        strict_1.default.equal(replay.status, 409);
    });
});
(0, node_test_1.default)("execute denies cross-tenant actor on approved proposal", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-a",
                tenantId: "studio-a",
                capabilityId: "firestore.batch.close",
                rationale: "Cross-tenant denial test proposal for batch close.",
                previewSummary: "tenant scoped close",
                requestInput: { batchId: "batch-a", tenantId: "studio-a" },
                expectedEffects: ["Batch closes in tenant a."],
                requestedBy: "staff-test-uid",
            }),
        });
        const createdPayload = (await created.json());
        const proposalId = String(createdPayload.proposal?.id ?? "");
        strict_1.default.ok(proposalId.length > 0);
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                approvedBy: "staff-test-uid",
                rationale: "Approved for tenant-scope denial verification.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const execute = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-b",
                tenantId: "studio-b",
                output: {},
            }),
        });
        strict_1.default.equal(execute.status, 409);
        const payload = (await execute.json());
        strict_1.default.equal(payload.decision?.reasonCode, "TENANT_MISMATCH");
        const audit = await fetch(`${baseUrl}/api/ops/audit?limit=20&actionPrefix=studio_ops.cross_tenant_denied`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(audit.status, 200);
        const auditPayload = (await audit.json());
        strict_1.default.ok(auditPayload.rows.some((row) => row.action === "studio_ops.cross_tenant_denied"));
    });
});
(0, node_test_1.default)("capabilities endpoint returns cockpit bootstrap payload", async () => {
    await withServer({}, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-1",
                ownerUid: "owner-1",
                capabilityId: "firestore.batch.close",
                rationale: "Bootstrap payload should include new pending proposal rows.",
                previewSummary: "Close batch mfb-888",
                requestInput: { batchId: "mfb-888" },
                expectedEffects: ["Batch is marked closed."],
            }),
        });
        strict_1.default.equal(created.status, 201);
        const createdPayload = (await created.json());
        const response = await fetch(`${baseUrl}/api/capabilities`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.ok(payload.capabilities.some((row) => row.id === "firestore.batch.close"));
        strict_1.default.ok(payload.proposals.some((row) => row.id === createdPayload.proposal.id));
        strict_1.default.equal(typeof payload.policy.killSwitch.enabled, "boolean");
        strict_1.default.ok(Array.isArray(payload.policy.exemptions));
        strict_1.default.ok(Array.isArray(payload.connectors));
    });
});
(0, node_test_1.default)("pilot rollback endpoint forwards idempotency and reason to executor", async () => {
    const rollbackCalls = [];
    const pilotExecutor = {
        dryRun: (input) => ({
            actionType: "ops_note_append",
            ownerUid: String(input.ownerUid ?? "owner-1"),
            resourceCollection: "batches",
            resourceId: String(input.resourceId ?? "batch-1"),
            notePreview: String(input.note ?? ""),
        }),
        execute: async (input) => ({
            idempotencyKey: input.idempotencyKey,
            proposalId: input.proposalId,
            replayed: false,
            resourcePointer: {
                collection: "studioBrainPilotOpsNotes",
                docId: "note-rollback-1",
            },
        }),
        rollback: async (input) => {
            rollbackCalls.push(input);
            return { ok: true, replayed: false };
        },
    };
    await withServer({ pilotWriteExecutor: pilotExecutor }, async (baseUrl) => {
        const created = await fetch(`${baseUrl}/api/capabilities/proposals`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                capabilityId: "firestore.ops_note.append",
                rationale: "Pilot rollback path should preserve idempotency linkage.",
                previewSummary: "Append ops note",
                requestInput: {
                    actionType: "ops_note_append",
                    ownerUid: "owner-1",
                    resourceCollection: "batches",
                    resourceId: "batch-1",
                    note: "Pilot note for rollback validation.",
                },
                expectedEffects: ["Add staff-visible note for ops context."],
            }),
        });
        strict_1.default.equal(created.status, 201);
        const createdPayload = (await created.json());
        const proposalId = createdPayload.proposal.id;
        const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                approvedBy: "staff-test-uid",
                rationale: "Approved pilot write before rollback validation.",
            }),
        });
        strict_1.default.equal(approved.status, 200);
        const execute = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/execute`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                actorType: "staff",
                actorId: "staff-test-uid",
                ownerUid: "owner-1",
                idempotencyKey: "pilot-rb-001",
                output: { executedFrom: "server-test" },
            }),
        });
        strict_1.default.equal(execute.status, 200);
        const rollback = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/rollback`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                idempotencyKey: "pilot-rb-001",
                reason: "Rollback requested after duplicate operator note.",
            }),
        });
        strict_1.default.equal(rollback.status, 200);
        const rollbackPayload = (await rollback.json());
        strict_1.default.equal(rollbackPayload.ok, true);
        strict_1.default.equal(rollbackCalls.length, 1);
        strict_1.default.equal(rollbackCalls[0].proposalId, proposalId);
        strict_1.default.equal(rollbackCalls[0].idempotencyKey, "pilot-rb-001");
        strict_1.default.equal(rollbackCalls[0].reason, "Rollback requested after duplicate operator note.");
        strict_1.default.equal(rollbackCalls[0].actorUid, "staff-test-uid");
    });
});
(0, node_test_1.default)("read-only memory endpoints allow staff auth without admin token when configured", async () => {
    await withServer({ adminToken: "secret-token" }, async (baseUrl) => {
        const captured = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: "Bearer test-staff",
                "x-studio-brain-admin-token": "secret-token",
            },
            body: JSON.stringify({
                content: "Handoff: keep startup continuity resilient.",
                source: "codex-handoff",
                metadata: { owner: "codex" },
            }),
        });
        strict_1.default.equal(captured.status, 201);
        const search = await fetch(`${baseUrl}/api/memory/search`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({ query: "startup continuity", limit: 5 }),
        });
        strict_1.default.equal(search.status, 200);
        const context = await fetch(`${baseUrl}/api/memory/context`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({ query: "startup continuity", maxItems: 3, maxChars: 512 }),
        });
        strict_1.default.equal(context.status, 200);
        const recent = await fetch(`${baseUrl}/api/memory/recent?limit=5`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(recent.status, 200);
        const stats = await fetch(`${baseUrl}/api/memory/stats`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(stats.status, 200);
        const captureBlocked = await fetch(`${baseUrl}/api/memory/capture`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
            body: JSON.stringify({
                content: "Decision: this write should stay admin-token gated.",
                source: "manual",
            }),
        });
        strict_1.default.equal(captureBlocked.status, 401);
    });
});
(0, node_test_1.default)("control tower state routes derive browser-friendly room and service data", async () => {
    const fixture = createControlTowerFixture();
    const { runner } = createControlTowerRunner();
    const stateStore = new memoryStores_1.MemoryStateStore();
    await stateStore.saveOverseerRun(buildSampleOverseerRun());
    try {
        await withServer({
            stateStore,
            controlTowerRepoRoot: fixture.root,
            controlTowerRunner: runner,
        }, async (baseUrl) => {
            const startupHandoff = await fetch(`${baseUrl}/api/memory/capture`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
                body: JSON.stringify({
                    content: "Handoff: verify startup continuity before launch.",
                    source: "codex-handoff",
                    metadata: {
                        rememberKind: "handoff",
                        startupEligible: true,
                        threadId: "thread-control-tower-memory-health",
                        threadEvidence: "explicit",
                    },
                }),
            });
            strict_1.default.equal(startupHandoff.status, 201);
            const secretCapture = await fetch(`${baseUrl}/api/memory/capture`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
                body: JSON.stringify({
                    content: "Operator note: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI0MiJ9.signature-value-1122334455",
                    source: "manual",
                }),
            });
            strict_1.default.equal(secretCapture.status, 201);
            const shadowMcpCapture = await fetch(`${baseUrl}/api/memory/capture`, {
                method: "POST",
                headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
                body: JSON.stringify({
                    content: "Connector result: MCP surfaced a repo sync status from an unapproved server.",
                    source: "mcp-tool:repo-sync",
                    metadata: {
                        mcpGovernance: {
                            approvalState: "pending",
                            shadowRisk: true,
                        },
                    },
                }),
            });
            strict_1.default.equal(shadowMcpCapture.status, 201);
            const response = await fetch(`${baseUrl}/api/control-tower/state`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(response.status, 200);
            const payload = (await response.json());
            strict_1.default.equal(payload.ok, true);
            strict_1.default.equal(payload.state.overview.activeRooms[0]?.id, "portal");
            strict_1.default.ok(payload.state.overview.needsAttention.length >= 1);
            strict_1.default.ok(payload.state.pinnedItems.some((entry) => entry.title === "Discord Relay is down"));
            strict_1.default.ok(payload.state.services.some((entry) => entry.id === "studio-brain-discord-relay" && entry.health === "error"));
            strict_1.default.equal(payload.state.board[0]?.owner, "agent-runtime");
            strict_1.default.equal(payload.state.board.some((entry) => entry.owner === "Memory maintenance"), true);
            strict_1.default.equal(payload.state.board.some((entry) => entry.owner === "Codex"), true);
            strict_1.default.equal(payload.state.board.find((entry) => entry.owner === "Codex")?.task?.includes("Investigate portal issue"), true);
            strict_1.default.equal(payload.state.memoryBrief.continuityState, "ready");
            strict_1.default.equal(payload.state.memoryBrief.consolidation.mode, "scheduled");
            strict_1.default.ok(payload.state.memoryBrief.consolidation.focusAreas.includes("Portal continuity"));
            strict_1.default.equal(payload.state.memoryBrief.consolidation.actionabilityStatus, "passed");
            strict_1.default.equal(payload.state.memoryBrief.consolidation.actionableInsightCount, 2);
            strict_1.default.deepEqual(payload.state.memoryBrief.consolidation.topActions?.slice(0, 2), [
                "Reuse the promoted approval summary memory as the canonical startup thread.",
                "Review and split the unknown mail-thread cluster before the next dream pass.",
            ]);
            strict_1.default.equal(payload.state.startupScorecard?.rubric.grade, "A");
            strict_1.default.equal(payload.state.startupScorecard?.rubric.overallScore, 98);
            strict_1.default.equal(payload.state.startupScorecard?.metrics.readyRate, 0.98);
            strict_1.default.equal(payload.state.startupScorecard?.metrics.groundingReadyRate, 0.97);
            strict_1.default.equal(payload.state.startupScorecard?.metrics.blockedContinuityRate, 0.01);
            strict_1.default.equal(payload.state.startupScorecard?.metrics.p95LatencyMs, 950);
            strict_1.default.equal(payload.state.startupScorecard?.supportingSignals.toolcalls.telemetryCoverageRate, 0.86);
            strict_1.default.equal(payload.state.startupScorecard?.coverage.gaps.length, 1);
            strict_1.default.equal(payload.state.startupScorecard?.launcherCoverage.liveStartupSamples, 7);
            strict_1.default.equal(payload.state.startupScorecard?.launcherCoverage.trustworthy, true);
            strict_1.default.equal(payload.state.agentRuntime?.status, "blocked");
            strict_1.default.equal(payload.state.agentRuntime?.boardRow.owner, "agent-runtime");
            strict_1.default.equal(payload.state.board[0]?.owner, "agent-runtime");
            strict_1.default.equal(payload.state.hosts.some((entry) => entry.hostId === "studio-brain-server"), true);
            strict_1.default.equal(payload.state.hosts.some((entry) => entry.hostId === "micah-laptop" && entry.environment === "local"), true);
            strict_1.default.equal(payload.state.partner?.initiativeState, "waiting_on_owner");
            strict_1.default.equal(payload.state.partner?.needsOwnerDecision, true);
            strict_1.default.match(payload.state.partner?.contactReason ?? "", /owner decision/i);
            strict_1.default.match(payload.state.partner?.singleDecisionNeeded ?? "", /unblock the portal lane|pause/i);
            strict_1.default.equal(payload.state.partner?.openLoops[0]?.id, "room:portal");
            strict_1.default.equal(payload.state.partner?.openLoops[0]?.roomId, "portal");
            strict_1.default.equal(payload.state.memoryHealth?.severity, "critical");
            strict_1.default.equal((payload.state.memoryHealth?.startupReadiness.startupEligibleRows ?? 0) >= 1, true);
            strict_1.default.equal((payload.state.memoryHealth?.startupReadiness.handoffRows ?? 0) >= 1, true);
            strict_1.default.equal((payload.state.memoryHealth?.secretExposureFindings.canonicalBlockedRows ?? 0) >= 1, true);
            strict_1.default.equal((payload.state.memoryHealth?.shadowMcpFindings.highRiskRows ?? 0) >= 1, true);
            strict_1.default.equal(Object.prototype.hasOwnProperty.call(payload.state.memoryHealth?.conflictBacklog ?? {}, "retrievalShadowedRows"), true);
            strict_1.default.equal((payload.state.memoryHealth?.highlights ?? []).some((entry) => /secret-bearing memories|shadowed by hard conflict retrieval rules/i.test(entry)), true);
            strict_1.default.equal(payload.state.overview.goodNextMoves.some((entry) => /promoted approval summary memory/i.test(entry.title)), false);
            strict_1.default.equal(payload.state.overview.goodNextMoves.some((entry) => /audit mcp governance coverage in memory|review quarantined secret-bearing memories/i.test(entry.title)), true);
            strict_1.default.equal(payload.state.overview.needsAttention.some((entry) => /secret-bearing memories need review|shadow mcp memory needs governance review/i.test(entry.title)), true);
            strict_1.default.ok(payload.state.events.some((entry) => entry.type === "memory.promoted"));
            strict_1.default.ok(payload.state.events.some((entry) => entry.sourceAction === "control_tower.memory_consolidation"));
            const roomResponse = await fetch(`${baseUrl}/api/control-tower/rooms/portal`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(roomResponse.status, 200);
            const roomPayload = (await roomResponse.json());
            strict_1.default.equal(roomPayload.ok, true);
            strict_1.default.equal(roomPayload.room.id, "portal");
            strict_1.default.equal(roomPayload.room.attach?.sessionName, "sb-room");
            strict_1.default.match(roomPayload.room.attach?.sshCommand ?? "", /ssh -t studiobrain/);
        });
    }
    finally {
        fixture.cleanup();
    }
});
(0, node_test_1.default)("kiln endpoints require staff auth", async () => {
    const kilnStore = new memoryStore_1.MemoryKilnStore();
    await kilnStore.upsertKiln(buildKiln());
    await withServer({
        kilnEnabled: true,
        kilnStore,
        artifactStore: createMemoryArtifactStore(),
    }, async (baseUrl) => {
        const unauth = await fetch(`${baseUrl}/api/kiln/overview`);
        strict_1.default.equal(unauth.status, 401);
        const nonStaff = await fetch(`${baseUrl}/kiln-command`, {
            headers: { authorization: "Bearer test-member" },
        });
        strict_1.default.equal(nonStaff.status, 401);
    });
});
(0, node_test_1.default)("kiln upload, detail, and artifact download routes preserve observed evidence", async () => {
    const kilnStore = new memoryStore_1.MemoryKilnStore();
    const artifactStore = createMemoryArtifactStore();
    const content = readKilnFixture("synthetic-single-zone.txt");
    await withServer({
        kilnEnabled: true,
        kilnStore,
        artifactStore,
    }, async (baseUrl) => {
        const upload = await fetch(`${baseUrl}/api/kiln/imports/genesis`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                filename: "synthetic-single-zone.txt",
                contentBase64: content.toString("base64"),
                observedAt: "2026-04-14T12:00:00.000Z",
                sourceLabel: "test-upload",
            }),
        });
        strict_1.default.equal(upload.status, 201);
        const uploadPayload = (await upload.json());
        strict_1.default.equal(uploadPayload.ok, true);
        const kilnDetail = await fetch(`${baseUrl}/api/kiln/kilns/${encodeURIComponent(uploadPayload.result.kiln.id)}`, { headers: { authorization: "Bearer test-staff" } });
        strict_1.default.equal(kilnDetail.status, 200);
        const runDetail = await fetch(`${baseUrl}/api/kiln/runs/${encodeURIComponent(uploadPayload.result.firingRun.id)}`, { headers: { authorization: "Bearer test-staff" } });
        strict_1.default.equal(runDetail.status, 200);
        const runPayload = (await runDetail.json());
        strict_1.default.equal(runPayload.ok, true);
        strict_1.default.equal(runPayload.detail.telemetry.length, 2);
        const artifactResponse = await fetch(`${baseUrl}/api/kiln/artifacts/${encodeURIComponent(uploadPayload.result.artifact.id)}/content`, { headers: { authorization: "Bearer test-staff" } });
        strict_1.default.equal(artifactResponse.status, 200);
        strict_1.default.equal(await artifactResponse.text(), content.toString("utf8"));
    });
});
(0, node_test_1.default)("kiln upload enforces decoded artifact byte limits", async () => {
    const kilnStore = new memoryStore_1.MemoryKilnStore();
    const artifactStore = createMemoryArtifactStore();
    const baseContent = readKilnFixture("synthetic-single-zone.txt");
    const content = Buffer.concat(Array.from({ length: 32 }, () => baseContent));
    await withServer({
        kilnEnabled: true,
        kilnStore,
        artifactStore,
        kilnImportMaxBytes: 4_096,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/kiln/imports/genesis`, {
            method: "POST",
            headers: {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            },
            body: JSON.stringify({
                filename: "too-large.txt",
                contentBase64: content.toString("base64"),
            }),
        });
        strict_1.default.equal(response.status, 413);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, false);
        strict_1.default.match(payload.message, /exceeds/i);
    });
});
(0, node_test_1.default)("kiln command page keeps control posture honest for human-triggered starts", async () => {
    const kilnStore = new memoryStore_1.MemoryKilnStore();
    const artifactStore = createMemoryArtifactStore();
    await kilnStore.upsertKiln(buildKiln());
    const run = await (0, orchestration_1.createFiringRun)(kilnStore, {
        kilnId: "kiln_test",
        requestedBy: "staff-test-uid",
        programName: "Cone 6 Glaze",
        queueState: "ready_for_start",
    });
    await (0, manualEvents_1.recordOperatorAction)(kilnStore, {
        kilnId: run.kilnId,
        firingRunId: run.id,
        actionType: "loaded_kiln",
        requestedBy: "staff-test-uid",
        enableSupportedWrites: false,
    });
    await (0, manualEvents_1.recordOperatorAction)(kilnStore, {
        kilnId: run.kilnId,
        firingRunId: run.id,
        actionType: "verified_clearance",
        requestedBy: "staff-test-uid",
        enableSupportedWrites: false,
    });
    await (0, manualEvents_1.recordOperatorAction)(kilnStore, {
        kilnId: run.kilnId,
        firingRunId: run.id,
        actionType: "pressed_start",
        requestedBy: "staff-test-uid",
        confirmedBy: "staff-test-uid",
        enableSupportedWrites: false,
    });
    await withServer({
        kilnEnabled: true,
        kilnStore,
        artifactStore,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/kiln-command`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const html = await response.text();
        strict_1.default.match(html, /Genesis remains the control authority/i);
        strict_1.default.match(html, /Human-triggered/);
        strict_1.default.doesNotMatch(html, /Supported write path/);
    });
});
(0, node_test_1.default)("kiln overview reflects imported telemetry and honest observed posture", async () => {
    const kilnStore = new memoryStore_1.MemoryKilnStore();
    const artifactStore = createMemoryArtifactStore();
    await (0, artifacts_1.importGenesisArtifact)({
        artifactStore,
        kilnStore,
        filename: "synthetic-three-zone.txt",
        content: readKilnFixture("synthetic-three-zone.txt"),
        source: "manual_upload",
    });
    await withServer({
        kilnEnabled: true,
        kilnStore,
        artifactStore,
    }, async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/kiln/overview`, {
            headers: { authorization: "Bearer test-staff" },
        });
        strict_1.default.equal(response.status, 200);
        const payload = (await response.json());
        strict_1.default.equal(payload.ok, true);
        strict_1.default.equal(payload.overview.kilns.length, 1);
        strict_1.default.equal(payload.overview.kilns[0]?.controlPosture, "Observed only");
        strict_1.default.equal(payload.overview.kilns[0]?.currentTemp, 2231);
    });
});
(0, node_test_1.default)("control tower promotes memory next moves only when startup quality is degraded", async () => {
    const fixture = createControlTowerFixture();
    const { runner } = createControlTowerRunner();
    const stateStore = new memoryStores_1.MemoryStateStore();
    await stateStore.saveOverseerRun(buildSampleOverseerRun());
    (0, node_fs_1.writeFileSync)((0, node_path_1.join)(fixture.root, "output", "qa", "codex-startup-scorecard.json"), `${JSON.stringify({
        schema: "codex-startup-scorecard.v1",
        generatedAtIso: "2026-03-30T10:05:00.000Z",
        latest: {
            sample: {
                status: "fail",
                reasonCode: "missing_token",
                continuityState: "blocked",
                latencyMs: 3200,
            },
        },
        metrics: {
            readyRate: 0.42,
            groundingReadyRate: 0.4,
            blockedContinuityRate: 0.25,
            p95LatencyMs: 3200,
        },
        supportingSignals: {
            toolcalls: {
                startupEntries: 4,
                startupFailures: 2,
                startupFailureRate: 0.5,
                groundingObservedEntries: 4,
                groundingLineComplianceRate: 0.5,
                preStartupRepoReadObservedEntries: 4,
                averagePreStartupRepoReads: 2,
                preStartupRepoReadFreeRate: 0.25,
                telemetryCoverageRate: 1,
                repeatFailureBursts: 1,
            },
        },
        coverage: {
            gaps: [],
        },
        rubric: {
            overallScore: 61,
            grade: "F",
        },
        recommendations: ["Restore startup continuity before repo exploration."],
    }, null, 2)}\n`, "utf8");
    try {
        await withServer({
            stateStore,
            controlTowerRepoRoot: fixture.root,
            controlTowerRunner: runner,
        }, async (baseUrl) => {
            const response = await fetch(`${baseUrl}/api/control-tower/state`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(response.status, 200);
            const payload = (await response.json());
            strict_1.default.equal(payload.ok, true);
            strict_1.default.equal(payload.state.startupScorecard?.rubric.grade, "F");
            strict_1.default.equal(payload.state.overview.goodNextMoves.some((entry) => /promoted approval summary memory/i.test(entry.title)), true);
            strict_1.default.equal(payload.state.overview.goodNextMoves.some((entry) => entry.actionLabel === "Review memory"), true);
        });
    }
    finally {
        fixture.cleanup();
    }
});
(0, node_test_1.default)("agent runtime routes expose latest summary and accept webhook events", async () => {
    const fixture = createControlTowerFixture();
    const { runner } = createControlTowerRunner();
    try {
        await withServer({
            controlTowerRepoRoot: fixture.root,
            controlTowerRunner: runner,
            adminToken: "test-admin-token",
        }, async (baseUrl) => {
            const latestResponse = await fetch(`${baseUrl}/api/agent-runtime/latest`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(latestResponse.status, 200);
            const latestPayload = (await latestResponse.json());
            strict_1.default.equal(latestPayload.ok, true);
            strict_1.default.equal(latestPayload.summary?.runId, "run-background-1");
            strict_1.default.equal(latestPayload.summary?.status, "blocked");
            strict_1.default.equal(latestPayload.events[0]?.type, "mission.state.changed");
            const detailResponse = await fetch(`${baseUrl}/api/agent-runtime/runs/run-background-1`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(detailResponse.status, 200);
            const detailPayload = (await detailResponse.json());
            strict_1.default.equal(detailPayload.ok, true);
            strict_1.default.equal(detailPayload.detail.runId, "run-background-1");
            strict_1.default.match(detailPayload.detail.whyStuck ?? "", /Verifier checks failed/i);
            strict_1.default.equal(detailPayload.detail.steps.some((entry) => entry.kind === "mission"), true);
            strict_1.default.equal(detailPayload.detail.artifacts.some((entry) => entry.artifactId === "summary.json"), true);
            const eventResponse = await fetch(`${baseUrl}/api/agent-runtime/events`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: "Bearer test-staff",
                    "x-studio-brain-admin-token": "test-admin-token",
                },
                body: JSON.stringify({
                    event: {
                        schema: "agent-run-ledger-event.v1",
                        eventId: "evt-2",
                        runId: "run-background-2",
                        missionId: "mission-background-2",
                        type: "mission.started",
                        occurredAt: "2026-03-30T10:10:00.000Z",
                        payload: { title: "Second runtime mission" },
                    },
                    summary: {
                        schema: "agent-runtime-summary.v1",
                        runId: "run-background-2",
                        missionId: "mission-background-2",
                        status: "running",
                        riskLane: "background",
                        title: "Second runtime mission",
                        goal: "Stay bounded",
                        groundingSources: ["codex-startup-preflight"],
                        acceptance: { total: 1, pending: 1, completed: 0, failed: 0 },
                        activeBlockers: [],
                        ratholeSignals: [],
                        memoriesInfluencingRun: ["Memory"],
                        goalMisses: [],
                        lastEventType: "mission.started",
                        updatedAt: "2026-03-30T10:10:00.000Z",
                        boardRow: {
                            id: "agent-runtime:run-background-2",
                            owner: "agent-runtime",
                            task: "Second runtime mission",
                            state: "running",
                            blocker: "none",
                            next: "Run verifier",
                            last_update: "2026-03-30T10:10:00.000Z",
                        },
                    },
                }),
            });
            strict_1.default.equal(eventResponse.status, 202);
            const runsResponse = await fetch(`${baseUrl}/api/agent-runtime/runs`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(runsResponse.status, 200);
            const runsPayload = (await runsResponse.json());
            strict_1.default.equal(runsPayload.ok, true);
            strict_1.default.equal(runsPayload.runs.some((entry) => entry.runId === "run-background-2"), true);
            const hostHeartbeatResponse = await fetch(`${baseUrl}/api/control-tower/hosts/heartbeat`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-studio-brain-admin-token": "test-admin-token",
                },
                body: JSON.stringify({
                    hostId: "micah-laptop",
                    label: "Micah Laptop",
                    environment: "local",
                    role: "operator-laptop",
                    health: "healthy",
                    lastSeenAt: "2026-03-30T10:11:00.000Z",
                    currentRunId: "run-background-2",
                    agentCount: 1,
                    metrics: {
                        cpuPct: 18,
                        memoryPct: 52,
                        load1: 0.5,
                    },
                }),
            });
            strict_1.default.equal(hostHeartbeatResponse.status, 202);
            const hostsResponse = await fetch(`${baseUrl}/api/control-tower/hosts`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(hostsResponse.status, 200);
            const hostsPayload = (await hostsResponse.json());
            strict_1.default.equal(hostsPayload.ok, true);
            strict_1.default.equal(hostsPayload.hosts.some((entry) => entry.hostId === "micah-laptop" && entry.currentRunId === "run-background-2"), true);
        });
    }
    finally {
        fixture.cleanup();
    }
});
(0, node_test_1.default)("partner routes generate briefs, record owner commands, and update open loops", async () => {
    const fixture = createControlTowerFixture();
    const { runner } = createControlTowerRunner();
    const stateStore = new memoryStores_1.MemoryStateStore();
    await stateStore.saveOverseerRun(buildSampleOverseerRun());
    try {
        await withServer({
            stateStore,
            controlTowerRepoRoot: fixture.root,
            controlTowerRunner: runner,
        }, async (baseUrl) => {
            const authHeaders = {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            };
            const latestResponse = await fetch(`${baseUrl}/api/control-tower/partner/latest`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(latestResponse.status, 200);
            const latestPayload = (await latestResponse.json());
            strict_1.default.equal(latestPayload.ok, true);
            strict_1.default.equal(latestPayload.partner?.initiativeState, "waiting_on_owner");
            strict_1.default.equal(latestPayload.partner?.openLoops[0]?.id, "room:portal");
            strict_1.default.equal(latestPayload.checkins.length, 0);
            const snoozeResponse = await fetch(`${baseUrl}/api/control-tower/partner/checkins`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ action: "snooze", snoozeMinutes: 90, note: "Quiet until after lunch." }),
            });
            strict_1.default.equal(snoozeResponse.status, 200);
            const snoozePayload = (await snoozeResponse.json());
            strict_1.default.equal(snoozePayload.ok, true);
            strict_1.default.equal(snoozePayload.partner?.initiativeState, "cooldown");
            strict_1.default.ok(Boolean(snoozePayload.partner?.cooldownUntil));
            strict_1.default.equal(snoozePayload.partner?.cooldownUntil, snoozePayload.partner?.nextCheckInAt);
            const delegateResponse = await fetch(`${baseUrl}/api/control-tower/partner/open-loops/${encodeURIComponent("room:portal")}`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ status: "delegated", note: "Redirect this to the verifier repair lane." }),
            });
            strict_1.default.equal(delegateResponse.status, 200);
            const delegatePayload = (await delegateResponse.json());
            strict_1.default.equal(delegatePayload.ok, true);
            strict_1.default.equal(delegatePayload.openLoop?.id, "room:portal");
            strict_1.default.equal(delegatePayload.openLoop?.status, "delegated");
            strict_1.default.equal(delegatePayload.partner?.openLoops.find((entry) => entry.id === "room:portal")?.status, "delegated");
            const latestAfterResponse = await fetch(`${baseUrl}/api/control-tower/partner/latest`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(latestAfterResponse.status, 200);
            const latestAfterPayload = (await latestAfterResponse.json());
            strict_1.default.equal(latestAfterPayload.ok, true);
            strict_1.default.equal(latestAfterPayload.checkins.some((entry) => entry.action === "snooze"), true);
            strict_1.default.equal(latestAfterPayload.checkins.some((entry) => entry.action === "redirect"), true);
            strict_1.default.equal(latestAfterPayload.partner?.openLoops.find((entry) => entry.id === "room:portal")?.status, "delegated");
        });
    }
    finally {
        fixture.cleanup();
    }
});
(0, node_test_1.default)("control tower actions send room instructions, persist room escalation, and run service actions", async () => {
    const fixture = createControlTowerFixture();
    const { runner, sentTexts, serviceActions } = createControlTowerRunner();
    const stateStore = new memoryStores_1.MemoryStateStore();
    await stateStore.saveOverseerRun(buildSampleOverseerRun());
    try {
        await withServer({
            stateStore,
            controlTowerRepoRoot: fixture.root,
            controlTowerRunner: runner,
        }, async (baseUrl) => {
            const authHeaders = {
                authorization: "Bearer test-staff",
                "content-type": "application/json",
            };
            const sendResponse = await fetch(`${baseUrl}/api/control-tower/rooms/portal/send`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ text: "status?" }),
            });
            strict_1.default.equal(sendResponse.status, 200);
            strict_1.default.equal(sentTexts[0]?.session, "sb-room");
            strict_1.default.equal(sentTexts[0]?.text, "status?");
            const pinResponse = await fetch(`${baseUrl}/api/control-tower/rooms/portal/pin`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ rationale: "Needs operator review." }),
            });
            strict_1.default.equal(pinResponse.status, 200);
            const stateResponse = await fetch(`${baseUrl}/api/control-tower/state`, {
                headers: { authorization: "Bearer test-staff" },
            });
            const statePayload = (await stateResponse.json());
            strict_1.default.equal(statePayload.state.rooms.find((entry) => entry.id === "portal")?.isEscalated, true);
            const serviceResponse = await fetch(`${baseUrl}/api/control-tower/services/studio-brain-discord-relay/actions`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ action: "restart" }),
            });
            strict_1.default.equal(serviceResponse.status, 200);
            strict_1.default.deepEqual(serviceActions[0], { service: "studio-brain-discord-relay", action: "restart" });
            const ackResponse = await fetch(`${baseUrl}/api/control-tower/overseer/ack`, {
                method: "POST",
                headers: authHeaders,
                body: JSON.stringify({ note: "Reviewed and queued." }),
            });
            strict_1.default.equal(ackResponse.status, 200);
            const eventsResponse = await fetch(`${baseUrl}/api/control-tower/events`, {
                headers: { authorization: "Bearer test-staff" },
            });
            strict_1.default.equal(eventsResponse.status, 200);
            const eventsPayload = (await eventsResponse.json());
            strict_1.default.ok(eventsPayload.events.some((entry) => entry.sourceAction === "studio_ops.control_tower.session_instruction_sent"));
            strict_1.default.ok(eventsPayload.events.some((entry) => entry.sourceAction === "studio_ops.control_tower.room_pinned"));
            strict_1.default.ok(eventsPayload.events.some((entry) => entry.sourceAction === "studio_ops.control_tower.service_action"));
            strict_1.default.ok(eventsPayload.events.some((entry) => entry.sourceAction === "studio_ops.control_tower.overseer_ack"));
            strict_1.default.ok(eventsPayload.events.some((entry) => entry.sourceAction === "control_tower.memory_brief" && entry.type === "memory.promoted"));
            strict_1.default.ok(eventsPayload.events.some((entry) => entry.sourceAction === "control_tower.memory_consolidation" &&
                entry.type === "memory.promoted" &&
                entry.payload?.mode === "scheduled"));
            const sseResponse = await fetch(`${baseUrl}/api/control-tower/events?stream=1&once=1`, {
                headers: {
                    authorization: "Bearer test-staff",
                    accept: "text/event-stream",
                },
            });
            strict_1.default.equal(sseResponse.status, 200);
            const sseText = await sseResponse.text();
            strict_1.default.match(sseText, /event:\s+memory\.promoted/);
            strict_1.default.match(sseText, /control_tower\.memory_consolidation/);
        });
    }
    finally {
        fixture.cleanup();
    }
});
