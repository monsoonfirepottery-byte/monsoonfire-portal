import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const require = createRequire(import.meta.url);

const DEFAULT_REPORT_PATH = resolve(REPO_ROOT, "output", "qa", "studiobrain-chief-of-staff-audit.json");
const STAFF_HEADERS = { authorization: "Bearer test-staff" };
const JSON_HEADERS = { authorization: "Bearer test-staff", "content-type": "application/json" };

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function loadModule(relativePath) {
  return require(resolve(REPO_ROOT, relativePath));
}

const { startHttpServer } = loadModule("studio-brain/lib/http/server.js");
const { MemoryEventStore, MemoryStateStore } = loadModule("studio-brain/lib/stores/memoryStores.js");
const { CapabilityRuntime, defaultCapabilities } = loadModule("studio-brain/lib/capabilities/runtime.js");
const { createInMemoryMemoryStoreAdapter } = loadModule("studio-brain/lib/memory/inMemoryAdapter.js");
const { createMemoryService } = loadModule("studio-brain/lib/memory/service.js");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function writeJson(filePath, payload) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function withServer(options, run) {
  const stateStore = options.stateStore ?? new MemoryStateStore();
  const eventStore = options.eventStore ?? new MemoryEventStore();
  const capabilityRuntime = new CapabilityRuntime(defaultCapabilities, eventStore);
  const memoryService =
    options.memoryService ??
    createMemoryService({
      store: createInMemoryMemoryStoreAdapter(),
      defaultTenantId: "monsoonfire-main",
      defaultAgentId: "audit-agent",
      defaultRunId: "audit-run",
    });

  const server = startHttpServer({
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
        return { uid: "staff-test-uid", isStaff: true, roles: ["staff"] };
      }
      if (authorizationHeader === "Bearer test-admin") {
        return { uid: "admin-test-uid", isStaff: true, roles: ["staff", "admin"] };
      }
      if (authorizationHeader === "Bearer test-member") {
        return { uid: "member-test-uid", isStaff: false, roles: [] };
      }
      throw new Error("Missing Authorization header.");
    },
    ...options,
  });

  await new Promise((resolveReady) => server.on("listening", resolveReady));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await run(baseUrl);
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => {
        if (error) rejectClose(error);
        else resolveClose();
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
  const root = mkdtempSync(join(tmpdir(), "studio-brain-control-tower-"));
  mkdirSync(join(root, "output", "ops-cockpit", "agents"), { recursive: true });
  mkdirSync(join(root, "output", "ops-cockpit", "agent-status"), { recursive: true });
  mkdirSync(join(root, "output", "stability"), { recursive: true });
  mkdirSync(join(root, "output", "overseer", "discord"), { recursive: true });
  mkdirSync(join(root, "output", "studio-brain", "memory-brief"), { recursive: true });
  mkdirSync(join(root, "output", "studio-brain", "memory-consolidation"), { recursive: true });
  mkdirSync(join(root, "output", "qa"), { recursive: true });
  mkdirSync(join(root, "output", "agent-runs", "run-background-1"), { recursive: true });

  writeFileSync(
    join(root, "output", "ops-cockpit", "agents", "sb-room.json"),
    `${JSON.stringify(
      {
        sessionName: "sb-room",
        cwd: "/home/wuff/monsoonfire-portal",
        tool: "codex",
        group: "portal",
        room: "portal",
        summary: "Portal lane",
        objective: "Investigate portal issue and report the next safe move.",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "output", "stability", "heartbeat-summary.json"),
    `${JSON.stringify({ status: "pass", checkedAt: "2026-03-30T10:00:00.000Z" }, null, 2)}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "output", "studio-brain", "memory-brief", "latest.json"),
    `${JSON.stringify(
      {
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
          outputs: ["output/studio-brain/memory-brief/latest.json", "output/memory/<overnight-run>/overnight-status.json"],
          actionabilityStatus: "repair",
          actionableInsightCount: 0,
          suppressedConnectionNoteCount: 0,
          suppressedPseudoDecisionCount: 0,
          topActions: ["Inspect portal lane"],
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "output", "studio-brain", "memory-consolidation", "latest.json"),
    `${JSON.stringify(
      {
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
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "output", "qa", "codex-startup-scorecard.json"),
    `${JSON.stringify(
      {
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
          gaps: [
            "Startup transcript telemetry is only partially captured; 86% of startup entries carried both Grounding and repo-read signals.",
          ],
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
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "output", "agent-runs", "run-background-1", "summary.json"),
    `${JSON.stringify(
      {
        schema: "agent-runtime-summary.v1",
        generatedAt: "2026-03-30T10:06:00.000Z",
        runId: "run-background-1",
        missionId: "mission-background-1",
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
            rankedBacklog: ["stale blocker cleanup", "unresolved review queues", "memory hygiene"],
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
          contactReason: "Studio Brain verified the blocked portal lane and is asking for one owner decision before it keeps moving.",
          verifiedContext: [
            "Verifier checks failed.",
            "Portal room is still waiting for direction.",
          ],
          decisionNeeded: "Decide whether to unblock the portal lane now or pause it until the verifier is fixed.",
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "output", "agent-runs", "run-background-1", "run-ledger.jsonl"),
    `${JSON.stringify({
      schema: "agent-run-ledger-event.v1",
      eventId: "evt-1",
      runId: "run-background-1",
      missionId: "mission-background-1",
      type: "mission.state.changed",
      occurredAt: "2026-03-30T10:06:00.000Z",
      payload: { status: "blocked" },
    })}\n`,
    "utf8",
  );

  writeFileSync(
    join(root, "output", "agent-runs", "latest.json"),
    `${JSON.stringify(
      {
        schema: "agent-runtime-pointer.v1",
        runId: "run-background-1",
        updatedAt: "2026-03-30T10:06:00.000Z",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
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
      if (!session) {
        return { ok: false, rc: 1, stdout: "", stderr: "missing", command: "tmux list-panes -t" };
      }
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

async function fetchJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const raw = await response.text();
  const payload = raw.trim().length > 0 ? JSON.parse(raw) : null;
  return { response, payload, raw };
}

function artifactPath(root, ...segments) {
  return join(root, ...segments);
}

async function runStep(steps, name, fn) {
  const startedAt = new Date().toISOString();
  try {
    const detail = await fn();
    steps.push({ name, status: "passed", startedAt, finishedAt: new Date().toISOString(), detail });
    return detail;
  } catch (error) {
    steps.push({
      name,
      status: "failed",
      startedAt,
      finishedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function runChiefOfStaffAudit(options = {}) {
  const reportPath = resolve(options.reportPath ?? DEFAULT_REPORT_PATH);
  const writeReport = options.writeReport !== false;
  const cleanupFixture = options.cleanupFixture !== false;

  const fixture = createControlTowerFixture();
  const { runner } = createControlTowerRunner();
  const stateStore = new MemoryStateStore();
  const eventStore = new MemoryEventStore();
  await stateStore.saveOverseerRun(buildSampleOverseerRun());

  const report = {
    schema: "studio-brain.chief-of-staff-audit.v1",
    status: "running",
    mode: "fixture",
    startedAtIso: new Date().toISOString(),
    finishedAtIso: null,
    reportPath: writeReport ? reportPath : null,
    fixtureRoot: fixture.root,
    cleanupFixture,
    steps: [],
    summary: null,
    artifacts: null,
    audits: [],
    error: null,
  };

  try {
    await withServer(
      {
        stateStore,
        eventStore,
        controlTowerRepoRoot: fixture.root,
        controlTowerRunner: runner,
      },
      async (baseUrl) => {
        const latest = await runStep(report.steps, "latest_partner_brief", async () => {
          const { response, payload, raw } = await fetchJson(baseUrl, "/api/control-tower/partner/latest", {
            headers: STAFF_HEADERS,
          });
          assert.equal(response.status, 200, `expected /partner/latest to return 200, got ${response.status} ${raw}`);
          assert.equal(payload?.ok, true, "expected partner/latest payload to be ok");
          assert.equal(payload?.partner?.initiativeState, "waiting_on_owner");
          assert.equal(payload?.partner?.openLoops?.[0]?.id, "room:portal");
          return {
            initiativeState: payload.partner.initiativeState,
            openLoopId: payload.partner.openLoops[0].id,
            checkinActions: payload.checkins.map((entry) => entry.action),
          };
        });

        const state = await runStep(report.steps, "control_tower_state", async () => {
          const { response, payload, raw } = await fetchJson(baseUrl, "/api/control-tower/state", {
            headers: STAFF_HEADERS,
          });
          assert.equal(response.status, 200, `expected /state to return 200, got ${response.status} ${raw}`);
          assert.equal(payload?.ok, true, "expected control tower state payload to be ok");
          assert.equal(payload?.state?.partner?.initiativeState, "waiting_on_owner");
          assert.equal(payload?.state?.partner?.needsOwnerDecision, true);
          assert.match(payload?.state?.partner?.contactReason ?? "", /owner decision/i);
          assert.equal(payload?.state?.partner?.openLoops?.[0]?.id, latest.openLoopId);
          return {
            activeRooms: payload.state.overview.activeRooms.map((entry) => entry.id),
            initiativeState: payload.state.partner.initiativeState,
            contactReason: payload.state.partner.contactReason,
            singleDecisionNeeded: payload.state.partner.singleDecisionNeeded,
            openLoopId: payload.state.partner.openLoops[0].id,
          };
        });

        await runStep(report.steps, "generate_partner_brief", async () => {
          const { response, payload, raw } = await fetchJson(baseUrl, "/api/control-tower/partner/brief", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({}),
          });
          assert.equal(response.status, 200, `expected /partner/brief to return 200, got ${response.status} ${raw}`);
          assert.equal(payload?.ok, true, "expected partner brief payload to be ok");
          assert.equal(payload?.partner?.initiativeState, "waiting_on_owner");
          return {
            initiativeState: payload.partner.initiativeState,
            recommendedFocus: payload.partner.recommendedFocus,
            openLoopCount: payload.partner.openLoops.length,
          };
        });

        const snooze = await runStep(report.steps, "record_snooze_checkin", async () => {
          const { response, payload, raw } = await fetchJson(baseUrl, "/api/control-tower/partner/checkins", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ action: "snooze", snoozeMinutes: 45, note: "Quiet until after the morning review window." }),
          });
          assert.equal(response.status, 200, `expected /partner/checkins snooze to return 200, got ${response.status} ${raw}`);
          assert.equal(payload?.ok, true, "expected snooze payload to be ok");
          assert.equal(payload?.partner?.initiativeState, "cooldown");
          assert.ok(Boolean(payload?.partner?.cooldownUntil), "expected cooldownUntil after snooze");
          assert.equal(payload?.partner?.cooldownUntil, payload?.partner?.nextCheckInAt);
          return {
            initiativeState: payload.partner.initiativeState,
            cooldownUntil: payload.partner.cooldownUntil,
            nextCheckInAt: payload.partner.nextCheckInAt,
          };
        });

        const continueCheckin = await runStep(report.steps, "record_continue_checkin", async () => {
          const { response, payload, raw } = await fetchJson(baseUrl, "/api/control-tower/partner/checkins", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ action: "continue", note: "Resume the bounded portal lane follow-up." }),
          });
          assert.equal(response.status, 200, `expected /partner/checkins continue to return 200, got ${response.status} ${raw}`);
          assert.equal(payload?.ok, true, "expected continue payload to be ok");
          assert.notEqual(payload?.partner?.initiativeState, "cooldown");
          return {
            initiativeState: payload.partner.initiativeState,
            cooldownUntil: payload.partner.cooldownUntil,
          };
        });

        const delegate = await runStep(report.steps, "delegate_open_loop", async () => {
          const { response, payload, raw } = await fetchJson(
            baseUrl,
            `/api/control-tower/partner/open-loops/${encodeURIComponent(latest.openLoopId)}`,
            {
              method: "POST",
              headers: JSON_HEADERS,
              body: JSON.stringify({ status: "delegated", note: "Redirect this to the verifier repair lane." }),
            },
          );
          assert.equal(response.status, 200, `expected /partner/open-loops to return 200, got ${response.status} ${raw}`);
          assert.equal(payload?.ok, true, "expected open-loop update payload to be ok");
          assert.equal(payload?.openLoop?.id, latest.openLoopId);
          assert.equal(payload?.openLoop?.status, "delegated");
          assert.equal(payload?.partner?.openLoops?.find((entry) => entry.id === latest.openLoopId)?.status, "delegated");
          return {
            openLoopId: payload.openLoop.id,
            openLoopStatus: payload.openLoop.status,
            initiativeState: payload.partner.initiativeState,
          };
        });

        const latestAfter = await runStep(report.steps, "latest_partner_brief_after_actions", async () => {
          const { response, payload, raw } = await fetchJson(baseUrl, "/api/control-tower/partner/latest", {
            headers: STAFF_HEADERS,
          });
          assert.equal(response.status, 200, `expected /partner/latest after actions to return 200, got ${response.status} ${raw}`);
          assert.equal(payload?.ok, true, "expected partner/latest after actions payload to be ok");
          const checkinActions = payload.checkins.map((entry) => entry.action);
          assert.equal(checkinActions.includes("snooze"), true);
          assert.equal(checkinActions.includes("continue"), true);
          assert.equal(checkinActions.includes("redirect"), true);
          assert.equal(payload?.partner?.openLoops?.find((entry) => entry.id === latest.openLoopId)?.status, "delegated");
          return {
            initiativeState: payload.partner.initiativeState,
            openLoopStatus: payload.partner.openLoops.find((entry) => entry.id === latest.openLoopId)?.status ?? null,
            checkinActions,
          };
        });

        const events = await runStep(report.steps, "control_tower_events", async () => {
          const { response, payload, raw } = await fetchJson(baseUrl, "/api/control-tower/events", {
            headers: STAFF_HEADERS,
          });
          assert.equal(response.status, 200, `expected /events to return 200, got ${response.status} ${raw}`);
          const sourceActions = payload.events.map((entry) => entry.sourceAction).filter(Boolean);
          assert.equal(sourceActions.includes("studio_ops.control_tower.partner_checkin"), true);
          assert.equal(sourceActions.includes("studio_ops.control_tower.partner_open_loop_updated"), true);
          return {
            eventCount: payload.events.length,
            sourceActions,
          };
        });

        const artifacts = await runStep(report.steps, "partner_artifacts", async () => {
          const latestBriefPath = artifactPath(fixture.root, "output", "studio-brain", "partner", "latest-brief.json");
          const checkinsPath = artifactPath(fixture.root, "output", "studio-brain", "partner", "checkins.jsonl");
          const openLoopsPath = artifactPath(fixture.root, "output", "studio-brain", "partner", "open-loops.json");
          const latestBrief = readJson(latestBriefPath);
          const checkins = readJsonLines(checkinsPath);
          const openLoops = readJson(openLoopsPath);
          const delegatedLoop = openLoops.rows.find((entry) => entry.id === latest.openLoopId);
          assert.equal(latestBrief.initiativeState, latestAfter.initiativeState);
          assert.equal(Array.isArray(checkins), true);
          assert.equal(checkins.some((entry) => entry.action === "snooze"), true);
          assert.equal(checkins.some((entry) => entry.action === "continue"), true);
          assert.equal(checkins.some((entry) => entry.action === "redirect"), true);
          assert.equal(delegatedLoop?.status, "delegated");
          return {
            latestBriefPath,
            checkinsPath,
            openLoopsPath,
            latestBriefInitiativeState: latestBrief.initiativeState,
            artifactOpenLoopStatus: delegatedLoop?.status ?? null,
            checkinActions: checkins.map((entry) => entry.action),
          };
        });

        const audits = await runStep(report.steps, "audit_log_entries", async () => {
          const rows = await eventStore.listRecent(30);
          const relevant = rows.filter(
            (entry) =>
              entry.action === "studio_ops.control_tower.partner_checkin" ||
              entry.action === "studio_ops.control_tower.partner_open_loop_updated",
          );
          assert.equal(relevant.some((entry) => entry.action === "studio_ops.control_tower.partner_checkin"), true);
          assert.equal(relevant.some((entry) => entry.action === "studio_ops.control_tower.partner_open_loop_updated"), true);
          return relevant.map((entry) => ({
            id: entry.id,
            at: entry.at,
            action: entry.action,
            actorId: entry.actorId,
            metadata: entry.metadata,
          }));
        });

        report.summary = {
          initialInitiativeState: latest.initiativeState,
          initialContactReason: state.contactReason,
          singleDecisionNeeded: state.singleDecisionNeeded,
          snoozeUntil: snooze.cooldownUntil,
          postContinueInitiativeState: continueCheckin.initiativeState,
          finalInitiativeState: latestAfter.initiativeState,
          openLoopId: latest.openLoopId,
          finalOpenLoopStatus: delegate.openLoopStatus,
          checkinActions: latestAfter.checkinActions,
          auditActions: audits.map((entry) => entry.action),
          eventSourceActions: events.sourceActions,
        };
        report.artifacts = artifacts;
        report.audits = audits;
        report.status = "passed";
      },
    );
  } catch (error) {
    report.status = "failed";
    report.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack ?? null : null,
    };
  } finally {
    report.finishedAtIso = new Date().toISOString();
    if (writeReport) {
      writeJson(reportPath, report);
    }
    if (cleanupFixture) {
      fixture.cleanup();
    }
  }

  return report;
}

export { DEFAULT_REPORT_PATH };
