import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHttpServer } from "./server";
import type { ArtifactStore } from "../connectivity/artifactStore";
import { defaultCapabilitySet, type Kiln } from "../kiln/domain/model";
import { MemoryKilnStore } from "../kiln/memoryStore";
import { importGenesisArtifact } from "../kiln/services/artifacts";
import { recordOperatorAction } from "../kiln/services/manualEvents";
import { createFiringRun } from "../kiln/services/orchestration";
import { MemoryEventStore, MemoryStateStore } from "../stores/memoryStores";
import { CapabilityRuntime, defaultCapabilities } from "../capabilities/runtime";
import { createInMemoryMemoryStoreAdapter } from "../memory/inMemoryAdapter";
import { createMemoryService } from "../memory/service";
import type { Runner } from "../controlTower/collect";

const logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function createMemoryArtifactStore(): ArtifactStore {
  const objects = new Map<string, Buffer>();
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

function readKilnFixture(name: string): Buffer {
  return readFileSync(join(__dirname, "..", "..", "src", "kiln", "adapters", "genesis-log", "fixtures", name));
}

function buildKiln(overrides: Partial<Kiln> = {}): Kiln {
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
    capabilitiesDetected: defaultCapabilitySet(),
    riskFlags: [],
    lastSeenAt: "2026-04-14T12:00:00.000Z",
    currentRunId: null,
    ...overrides,
  };
}

function buildIngestHeaders(secret: string, payload: Record<string, unknown>, timestampSeconds: number = Math.trunc(Date.now() / 1000)): Record<string, string> {
  const raw = JSON.stringify(payload);
  const signature = crypto.createHmac("sha256", secret).update(`${timestampSeconds}.${raw}`).digest("hex");
  return {
    "content-type": "application/json",
    "x-memory-ingest-timestamp": `${timestampSeconds}`,
    "x-memory-ingest-signature": `v1=${signature}`,
  };
}

async function withServer(
  options: Partial<Parameters<typeof startHttpServer>[0]>,
  run: (baseUrl: string) => Promise<void>
): Promise<void> {
  const stateStore = options.stateStore ?? new MemoryStateStore();
  const eventStore = options.eventStore ?? new MemoryEventStore();
  const capabilityRuntime = new CapabilityRuntime(defaultCapabilities, eventStore);
  const memoryService =
    options.memoryService ??
    createMemoryService({
      store: createInMemoryMemoryStoreAdapter(),
      defaultTenantId: "monsoonfire-main",
      defaultAgentId: "test-agent",
      defaultRunId: "test-run",
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

  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

function buildSampleOverseerRun(overrides: Partial<import("../stores/interfaces").OverseerRunRecord> = {}): import("../stores/interfaces").OverseerRunRecord {
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
          gaps: ["Startup transcript telemetry is only partially captured; 86% of startup entries carried both Grounding and repo-read signals."],
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

  return {
    root,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function createControlTowerRunner() {
  const sessions = new Map<
    string,
    { cwd: string; command: string; room?: string; sessionActivity: string; paneId: string; attached?: boolean }
  >([
    ["studiobrain", { cwd: "/home/wuff/monsoonfire-portal", command: "bash", sessionActivity: "1711792800", paneId: "%100", attached: true }],
    ["sb-room", { cwd: "/home/wuff/monsoonfire-portal", command: "codex", room: "portal", sessionActivity: "1711796400", paneId: "%101" }],
  ]);
  const sentTexts: Array<{ session: string; text: string }> = [];
  const serviceActions: Array<{ service: string; action: string }> = [];

  const runner: Runner = (command, args = []) => {
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
      if (!session) return { ok: false, rc: 1, stdout: "", stderr: "missing", command: "tmux list-panes -t" };
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

test("health endpoint returns ok", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);
    const payload = (await response.json()) as { ok: boolean; service: string };
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.service, "studio-brain");
  });
});

test("readyz fails when snapshot freshness is required and missing", async () => {
  await withServer(
    {
      requireFreshSnapshotForReady: true,
      readyMaxSnapshotAgeMinutes: 10,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/readyz`);
      const payload = (await response.json()) as { ok: boolean };
      assert.equal(response.status, 503);
      assert.equal(payload.ok, false);
    }
  );
});

test("readyz succeeds without requiring fresh snapshot", async () => {
  await withServer(
    {
      requireFreshSnapshotForReady: false,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/readyz`);
      const payload = (await response.json()) as { ok: boolean };
      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
    }
  );
});

test("status endpoint includes runtime payload and recent jobs", async () => {
  const stateStore = new MemoryStateStore();
  await stateStore.startJobRun("computeStudioState");

  await withServer(
    {
      stateStore,
      getRuntimeStatus: () => ({ scheduler: { intervalMs: 1000 }, custom: "ok" }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/status`);
      const payload = (await response.json()) as {
        ok: boolean;
        runtime: { custom?: string };
        jobRuns: unknown[];
      };

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.runtime.custom, "ok");
      assert.ok(Array.isArray(payload.jobRuns));
      assert.ok(payload.jobRuns.length >= 1);
    }
  );
});

test("metrics endpoint includes process payload", async () => {
  await withServer(
    {
      getRuntimeMetrics: () => ({ scheduler: { intervalMs: 1000 } }),
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/metrics`);
      const payload = (await response.json()) as {
        ok: boolean;
        metrics: { process: { pid: number; uptimeSec: number } };
      };
      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.ok(payload.metrics.process.pid > 0);
      assert.ok(payload.metrics.process.uptimeSec >= 0);
    }
  );
});

test("overseer endpoints return latest run payload and bounded history", async () => {
  const stateStore = new MemoryStateStore();
  await stateStore.saveOverseerRun(buildSampleOverseerRun());
  await stateStore.saveOverseerRun(
    buildSampleOverseerRun({
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
    })
  );

  await withServer({ stateStore }, async (baseUrl) => {
    const latest = await fetch(`${baseUrl}/api/overseer/latest`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(latest.status, 200);
    const latestPayload = (await latest.json()) as {
      ok: boolean;
      overseer: { runId: string; overallStatus: string };
    };
    assert.equal(latestPayload.ok, true);
    assert.equal(latestPayload.overseer.runId, "ovr_test_2");
    assert.equal(latestPayload.overseer.overallStatus, "critical");

    const runs = await fetch(`${baseUrl}/api/overseer/runs?limit=1`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(runs.status, 200);
    const runsPayload = (await runs.json()) as {
      ok: boolean;
      rows: Array<{ runId: string }>;
    };
    assert.equal(runsPayload.ok, true);
    assert.equal(runsPayload.rows.length, 1);
    assert.equal(runsPayload.rows[0].runId, "ovr_test_2");
  });
});

test("overseer endpoints require staff auth", async () => {
  const stateStore = new MemoryStateStore();
  await stateStore.saveOverseerRun(buildSampleOverseerRun());

  await withServer({ stateStore }, async (baseUrl) => {
    const unauth = await fetch(`${baseUrl}/api/overseer/latest`);
    assert.equal(unauth.status, 401);

    const nonStaff = await fetch(`${baseUrl}/api/overseer/runs?limit=5`, {
      headers: { authorization: "Bearer test-member" },
    });
    assert.equal(nonStaff.status, 401);
  });
});

test("overseer discord endpoint returns latest delivery payload", async () => {
  const stateStore = new MemoryStateStore();
  await stateStore.saveOverseerRun(buildSampleOverseerRun());

  await withServer({ stateStore }, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/overseer/discord/latest`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      discord: {
        runId: string;
        delivery: {
          mcp?: { serverName: string };
          target?: { channelId: string | null };
        };
      };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.discord.runId, "ovr_test_1");
    assert.equal(payload.discord.delivery.mcp?.serverName, "discord");
    assert.equal(payload.discord.delivery.target?.channelId, "channel-1");
  });
});

test("memory endpoints capture, search, recent, stats, and import", async () => {
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
    assert.equal(captured.status, 201);
    const capturePayload = (await captured.json()) as { ok: boolean; memory: { id: string } };
    assert.equal(capturePayload.ok, true);
    assert.ok(capturePayload.memory.id.startsWith("mem_"));

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
    assert.equal(startupHandoff.status, 201);

    const secretCapture = await fetch(`${baseUrl}/api/memory/capture`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        content:
          "Operator note: Authorization: Bearer test-redaction-token",
        source: "manual",
      }),
    });
    assert.equal(secretCapture.status, 201);

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
    assert.equal(shadowMcpCapture.status, 201);

    const searched = await fetch(`${baseUrl}/api/memory/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({ query: "QA payment blockers", limit: 5 }),
    });
    assert.equal(searched.status, 200);
    const searchPayload = (await searched.json()) as {
      ok: boolean;
      rows: Array<{ id: string; content: string }>;
    };
    assert.equal(searchPayload.ok, true);
    assert.ok(searchPayload.rows.some((row) => row.id === capturePayload.memory.id));

    const recent = await fetch(`${baseUrl}/api/memory/recent?limit=5`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(recent.status, 200);
    const recentPayload = (await recent.json()) as { ok: boolean; rows: Array<{ id: string }> };
    assert.equal(recentPayload.ok, true);
    assert.ok(recentPayload.rows.length >= 1);

    const stats = await fetch(`${baseUrl}/api/memory/stats`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(stats.status, 200);
    const statsPayload = (await stats.json()) as {
      ok: boolean;
      stats: {
        total: number;
        bySource: Array<{ source: string; count: number }>;
        startupReadiness?: { startupEligibleRows: number; handoffRows: number };
        secretExposureFindings?: { canonicalBlockedRows: number };
        shadowMcpFindings?: { highRiskRows: number };
      };
    };
    assert.equal(statsPayload.ok, true);
    assert.ok(statsPayload.stats.total >= 1);
    assert.ok(statsPayload.stats.bySource.some((entry) => entry.source === "manual"));
    assert.equal((statsPayload.stats.startupReadiness?.startupEligibleRows ?? 0) >= 1, true);
    assert.equal((statsPayload.stats.startupReadiness?.handoffRows ?? 0) >= 1, true);
    assert.equal((statsPayload.stats.secretExposureFindings?.canonicalBlockedRows ?? 0) >= 1, true);
    assert.equal((statsPayload.stats.shadowMcpFindings?.highRiskRows ?? 0) >= 1, true);

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
    assert.equal(context.status, 200);
    const contextPayload = (await context.json()) as {
      ok: boolean;
      context: { items: Array<{ id: string }>; budget: { maxItems: number; maxChars: number } };
    };
    assert.equal(contextPayload.ok, true);
    assert.ok(contextPayload.context.items.length >= 1);
    assert.equal(contextPayload.context.budget.maxItems, 3);
    assert.equal(contextPayload.context.budget.maxChars, 512);

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
    assert.equal(imported.status, 201);
    const importPayload = (await imported.json()) as {
      ok: boolean;
      result: { imported: number; failed: number };
    };
    assert.equal(importPayload.ok, true);
    assert.equal(importPayload.result.imported, 2);
    assert.equal(importPayload.result.failed, 0);
  });
});

test("memory neighborhood endpoint returns ranked rows with relationship diagnostics", async () => {
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
    assert.equal(first.status, 201);
    const firstPayload = (await first.json()) as { memory: { id: string } };

    const second = await fetch(`${baseUrl}/api/memory/capture`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        content: "Follow-up thread item with kiln loading constraints.",
        source: "manual",
        metadata: { owner: "ops" },
      }),
    });
    assert.equal(second.status, 201);
    const secondPayload = (await second.json()) as { memory: { id: string } };

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
    assert.equal(seed.status, 201);
    const seedPayload = (await seed.json()) as { memory: { id: string } };

    const response = await fetch(`${baseUrl}/api/memory/neighborhood`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        seedMemoryId: seedPayload.memory.id,
        maxHops: 2,
        maxItems: 8,
      }),
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      neighborhood: {
        seedMemoryId: string;
        nodes: Array<{ id: string }>;
      };
      edgeSummary: {
        nodeCount: number;
        unresolvedConflictCount: number;
      };
      relationshipTypeCounts: Record<string, number>;
      diagnostics: {
        previewSummaries: Array<{ id: string; summary: string }>;
      };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.neighborhood.seedMemoryId, seedPayload.memory.id);
    assert.ok(payload.neighborhood.nodes.some((row) => row.id === seedPayload.memory.id));
    assert.ok(payload.edgeSummary.nodeCount >= 1);
    assert.ok(Number(payload.relationshipTypeCounts.related ?? 0) >= 1);
    assert.ok(payload.edgeSummary.unresolvedConflictCount >= 1);
    assert.ok(payload.diagnostics.previewSummaries.length >= 1);
  });
});

test("relationship diagnostics endpoint validates requests and returns edge summary contract", async () => {
  await withServer({}, async (baseUrl) => {
    const capture = await fetch(`${baseUrl}/api/memory/capture`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        content: "Ticket handoff note with continuity and queue context.",
        source: "manual",
      }),
    });
    assert.equal(capture.status, 201);

    const invalid = await fetch(`${baseUrl}/api/memory/relationship-diagnostics`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({ maxItems: 8 }),
    });
    assert.equal(invalid.status, 400);

    const response = await fetch(`${baseUrl}/api/memory/relationship-diagnostics`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        query: "handoff continuity queue",
        maxItems: 8,
        maxHops: 2,
      }),
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      diagnostics: {
        query: string | null;
        edgeSummary: { nodeCount: number; edgeCount: number };
        relationshipTypeCounts: Record<string, number>;
        previewSummaries: Array<{ id: string; summary: string }>;
      };
    };
    assert.equal(payload.ok, true);
    assert.equal(payload.diagnostics.query, "handoff continuity queue");
    assert.ok(payload.diagnostics.edgeSummary.nodeCount >= 1);
    assert.ok(payload.diagnostics.edgeSummary.edgeCount >= 0);
    assert.equal(typeof payload.diagnostics.relationshipTypeCounts, "object");
    assert.ok(payload.diagnostics.previewSummaries.length >= 1);
  });
});

test("memory endpoints require staff auth", async () => {
  await withServer({}, async (baseUrl) => {
    const unauth = await fetch(`${baseUrl}/api/memory/stats`);
    assert.equal(unauth.status, 401);

    const contextUnauth = await fetch(`${baseUrl}/api/memory/context`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxItems: 5 }),
    });
    assert.equal(contextUnauth.status, 401);

    const nonStaff = await fetch(`${baseUrl}/api/memory/stats`, {
      headers: { authorization: "Bearer test-member" },
    });
    assert.equal(nonStaff.status, 401);
  });
});

test("memory ingest endpoint is disabled by default", async () => {
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
    assert.equal(response.status, 404);
  });
});

test("memory ingest accepts valid signed discord payloads when enabled", async () => {
  await withServer(
    {
      memoryIngestConfig: {
        enabled: true,
        hmacSecret: "ingest-secret",
        allowedSources: ["discord"],
        allowedDiscordGuildIds: ["guild-1"],
        allowedDiscordChannelIds: ["channel-1"],
        requireClientRequestId: true,
      },
    },
    async (baseUrl) => {
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
      assert.equal(response.status, 201);
      const body = (await response.json()) as { ok: boolean; memory: { id: string; source: string } };
      assert.equal(body.ok, true);
      assert.ok(body.memory.id.startsWith("mem_req_"));
      assert.equal(body.memory.source, "discord");
    }
  );
});

test("memory ingest rejects stale signatures, invalid signature, and missing client request id", async () => {
  await withServer(
    {
      memoryIngestConfig: {
        enabled: true,
        hmacSecret: "ingest-secret",
        allowedSources: ["discord"],
        allowedDiscordGuildIds: ["guild-1"],
        allowedDiscordChannelIds: ["channel-1"],
        requireClientRequestId: true,
      },
    },
    async (baseUrl) => {
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
      assert.equal(staleResponse.status, 401);

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
      assert.equal(invalidSigResponse.status, 401);

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
      assert.equal(missingRequestIdResponse.status, 400);
    }
  );
});

test("memory ingest enforces source and discord allowlists", async () => {
  await withServer(
    {
      memoryIngestConfig: {
        enabled: true,
        hmacSecret: "ingest-secret",
        allowedSources: ["discord"],
        allowedDiscordGuildIds: ["guild-1"],
        allowedDiscordChannelIds: ["channel-1"],
        requireClientRequestId: true,
      },
    },
    async (baseUrl) => {
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
      assert.equal(blockedSource.status, 403);

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
      assert.equal(blockedGuild.status, 403);
    }
  );
});

test("ops scorecard endpoint returns KPI status and records compute event", async () => {
  const stateStore = new MemoryStateStore();
  const eventStore = new MemoryEventStore();
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

  await withServer(
    {
      stateStore,
      eventStore,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/scorecard`, {
        headers: { authorization: "Bearer test-staff" },
      });
      assert.equal(response.status, 200);
      const payload = (await response.json()) as {
        ok: boolean;
        scorecard: {
          overallStatus: string;
          metrics: Array<{ key: string; status: string }>;
        };
      };
      assert.equal(payload.ok, true);
      assert.ok(["ok", "warning", "critical"].includes(payload.scorecard.overallStatus));
      assert.equal(payload.scorecard.metrics.length, 5);
      const rows = await eventStore.listRecent(10);
      assert.ok(rows.some((row) => row.action === "studio_ops.scorecard_computed"));
    }
  );
});

test("handler failure returns 500 without crashing server", async () => {
  const stateStore = new MemoryStateStore();
  const badStateStore = stateStore as MemoryStateStore & {
    getLatestStudioState: () => Promise<never>;
  };
  badStateStore.getLatestStudioState = async () => {
    throw new Error("boom");
  };

  await withServer(
    {
      stateStore: badStateStore,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/studio-state/latest`);
      const payload = (await response.json()) as { ok: boolean; message: string };
      assert.equal(response.status, 500);
      assert.equal(payload.ok, false);
      assert.equal(payload.message, "Internal server error");
    }
  );
});

test("capability workflow enforces approval before execution", async () => {
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
    assert.equal(created.status, 201);
    const createdPayload = (await created.json()) as {
      proposal: { id: string; requestedBy: string };
    };
    assert.equal(createdPayload.proposal.requestedBy, "staff-test-uid");
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
    assert.equal(denied.status, 409);

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        approvedBy: "staff-approver",
        rationale: "Approved after staff review and compliance verification.",
      }),
    });
    assert.equal(approved.status, 200);

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
    assert.equal(executed.status, 200);
    const executedPayload = (await executed.json()) as { proposal: { status: string } };
    assert.equal(executedPayload.proposal.status, "executed");
  });
});

test("quota endpoints list and reset buckets", async () => {
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
    const createdPayload = (await created.json()) as { proposal: { id: string } };
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
    assert.equal(listed.status, 200);
    const listedPayload = (await listed.json()) as {
      buckets: Array<{ bucket: string; count: number }>;
    };
    assert.ok(listedPayload.buckets.length >= 1);
    const targetBucket = listedPayload.buckets[0].bucket;

    const reset = await fetch(`${baseUrl}/api/capabilities/quotas/${encodeURIComponent(targetBucket)}/reset`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({ reason: "Emergency counter reset during incident triage." }),
    });
    assert.equal(reset.status, 200);
  });
});

test("capability audit endpoint returns filtered capability events", async () => {
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
    const createdPayload = (await created.json()) as { proposal: { id: string } };
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
    assert.equal(auditResp.status, 200);
    const payload = (await auditResp.json()) as { rows: Array<{ action: string }> };
    assert.ok(payload.rows.length >= 1);
    assert.ok(payload.rows.every((row) => row.action.startsWith("capability.")));

    const filtered = await fetch(
      `${baseUrl}/api/capabilities/audit?limit=20&actionPrefix=capability.hubitat.devices.read`,
      { headers: { authorization: "Bearer test-staff" } }
    );
    assert.equal(filtered.status, 200);
    const filteredPayload = (await filtered.json()) as { rows: Array<{ action: string }> };
    assert.ok(filteredPayload.rows.length >= 1);
    assert.ok(filteredPayload.rows.every((row) => row.action.startsWith("capability.hubitat.devices.read")));
  });
});

test("capability audit export endpoint returns verifiable bundle", async () => {
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
    assert.equal(created.status, 201);
    const response = await fetch(`${baseUrl}/api/capabilities/audit/export?limit=50`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      bundle: { manifest: { rowCount: number; payloadHash: string } };
    };
    assert.equal(payload.ok, true);
    assert.ok(payload.bundle.manifest.rowCount >= 1);
    assert.ok(payload.bundle.manifest.payloadHash.length > 10);
  });
});

test("quota reset requires a reason", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/capabilities/quotas/missing/reset`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
  });
});

test("approval and rejection endpoints require rationale", async () => {
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
    const createdPayload = (await created.json()) as { proposal: { id: string } };
    const proposalId = createdPayload.proposal.id;

    const missingApproveRationale = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missingApproveRationale.status, 400);

    const missingRejectRationale = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reject`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missingRejectRationale.status, 400);
  });
});

test("kill switch blocks execution even for approved proposal", async () => {
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
    const createdPayload = (await created.json()) as { proposal: { id: string } };
    const proposalId = createdPayload.proposal.id;

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        rationale: "Approved after staff review and compliance verification.",
      }),
    });
    assert.equal(approved.status, 200);

    const killSwitchOn = await fetch(`${baseUrl}/api/capabilities/policy/kill-switch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        enabled: true,
        rationale: "Emergency freeze while policy behavior is validated.",
      }),
    });
    assert.equal(killSwitchOn.status, 200);

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
    assert.equal(executeBlocked.status, 409);
    const payload = (await executeBlocked.json()) as { decision: { reasonCode: string } };
    assert.equal(payload.decision.reasonCode, "BLOCKED_BY_POLICY");
  });
});

test("capability endpoints require admin token when configured", async () => {
  await withServer(
    {
      adminToken: "secret-token",
      allowedOrigins: ["http://127.0.0.1:5173"],
    },
    async (baseUrl) => {
      const preflight = await fetch(`${baseUrl}/api/capabilities`, {
        method: "OPTIONS",
        headers: { Origin: "http://127.0.0.1:5173" },
      });
      assert.equal(preflight.status, 204);

      const unauthorized = await fetch(`${baseUrl}/api/capabilities`, {
        method: "GET",
        headers: { Origin: "http://127.0.0.1:5173", authorization: "Bearer test-staff" },
      });
      assert.equal(unauthorized.status, 401);

      const authorized = await fetch(`${baseUrl}/api/capabilities`, {
        method: "GET",
        headers: {
          Origin: "http://127.0.0.1:5173",
          authorization: "Bearer test-staff",
          "x-studio-brain-admin-token": "secret-token",
        },
      });
      assert.equal(authorized.status, 200);
    }
  );
});

test("capability endpoints reject non-staff principal", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/capabilities`, {
      method: "GET",
      headers: { authorization: "Bearer test-member" },
    });
    assert.equal(response.status, 401);
  });
});

test("capability policy lint endpoint returns lint status", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/capabilities/policy-lint`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      capabilitiesChecked: number;
      violations: Array<{ code: string }>;
    };
    assert.equal(payload.ok, true);
    assert.ok(payload.capabilitiesChecked >= 1);
    assert.ok(Array.isArray(payload.violations));
  });
});

test("connector health endpoint returns connector rows", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/connectors/health`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { connectors: Array<{ id: string }> };
    assert.ok(Array.isArray(payload.connectors));
  });
});

test("proposal endpoint rejects agent actor without delegation", async () => {
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
    assert.equal(response.status, 403);
    const payload = (await response.json()) as { reasonCode: string };
    assert.equal(payload.reasonCode, "DELEGATION_MISSING");
  });
});

test("proposal and execute allow agent actor with valid delegation", async () => {
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
    assert.equal(create.status, 201);
    const createdPayload = (await create.json()) as { proposal: { id: string } };
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
    assert.equal(execute.status, 200);
  });
});

test("ops recommendation drafts endpoint returns detector drafts", async () => {
  const eventStore = new MemoryEventStore();
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
  await withServer(
    {
      eventStore,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/recommendations/drafts?limit=10`, {
        headers: { authorization: "Bearer test-staff" },
      });
      assert.equal(response.status, 200);
      const payload = (await response.json()) as { rows: Array<{ ruleId: string }> };
      assert.equal(payload.rows.length, 1);
      assert.equal(payload.rows[0].ruleId, "queue_spike");
    }
  );
});

test("marketing drafts endpoint lists drafts and review updates status", async () => {
  const eventStore = new MemoryEventStore();
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
    assert.equal(listed.status, 200);
    const listedPayload = (await listed.json()) as { rows: Array<{ draftId: string; status: string }> };
    assert.equal(listedPayload.rows[0].draftId, "mk-2026-02-13-ig");
    assert.equal(listedPayload.rows[0].status, "draft");

    const review = await fetch(`${baseUrl}/api/marketing/drafts/mk-2026-02-13-ig/review`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({
        toStatus: "needs_review",
        rationale: "Reviewed for tone and content alignment before publish queue.",
      }),
    });
    assert.equal(review.status, 200);
  });
});

test("finance reconciliation drafts endpoint returns finance drafts", async () => {
  await withServer({}, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/finance/reconciliation/drafts?limit=10`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { rows: Array<{ ruleId: string }> };
    assert.ok(Array.isArray(payload.rows));
  });
});

test("ops drills endpoint records drill events", async () => {
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
    assert.equal(post.status, 200);
    const list = await fetch(`${baseUrl}/api/ops/drills?limit=10`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(list.status, 200);
    const payload = (await list.json()) as { rows: Array<{ scenarioId: string }> };
    assert.ok(payload.rows.some((row) => row.scenarioId === "token_compromise"));
  });
});

test("ops drills endpoint enforces auth and required drill fields", async () => {
  await withServer({}, async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/ops/drills`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenarioId: "connector_outage",
        status: "started",
      }),
    });
    assert.equal(unauthorized.status, 401);

    const missingScenario = await fetch(`${baseUrl}/api/ops/drills`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        status: "started",
      }),
    });
    assert.equal(missingScenario.status, 400);

    const missingStatus = await fetch(`${baseUrl}/api/ops/drills`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        scenarioId: "connector_outage",
      }),
    });
    assert.equal(missingStatus.status, 400);

    const nonStaff = await fetch(`${baseUrl}/api/ops/drills`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-member" },
      body: JSON.stringify({
        scenarioId: "connector_outage",
        status: "started",
      }),
    });
    assert.equal(nonStaff.status, 401);
  });
});

test("ops drills endpoint preserves mttr and unresolved risk metadata", async () => {
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
    assert.equal(posted.status, 200);

    const list = await fetch(`${baseUrl}/api/ops/drills?limit=10`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(list.status, 200);
    const payload = (await list.json()) as {
      rows: Array<{
        scenarioId: string | null;
        status: string | null;
        outcome: string | null;
        mttrMinutes: number | null;
        unresolvedRisks: string[];
      }>;
    };
    const row = payload.rows.find((entry) => entry.scenarioId === "policy_bypass_attempt");
    assert.ok(row);
    assert.equal(row?.status, "completed");
    assert.equal(row?.outcome, "partial");
    assert.equal(row?.mttrMinutes, 42);
    assert.deepEqual(row?.unresolvedRisks ?? [], ["alert-routing-followup", "playbook-clarification"]);
  });
});

test("ops drills endpoint events are queryable in ops audit stream", async () => {
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
    assert.equal(post.status, 200);

    const audit = await fetch(`${baseUrl}/api/ops/audit?limit=20&actionPrefix=studio_ops.drill_event`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(audit.status, 200);
    const payload = (await audit.json()) as {
      rows: Array<{
        action: string;
        metadata?: { scenarioId?: string; status?: string; outcome?: string };
      }>;
    };
    const row = payload.rows.find((entry) => entry.action === "studio_ops.drill_event");
    assert.ok(row);
    assert.equal(row?.metadata?.scenarioId, "connector_outage");
    assert.equal(row?.metadata?.status, "completed");
    assert.equal(row?.metadata?.outcome, "success");
  });
});

test("ops degraded endpoint records entry and audit list returns events", async () => {
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
    assert.equal(post.status, 200);
    const list = await fetch(`${baseUrl}/api/ops/audit?limit=10`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(list.status, 200);
    const payload = (await list.json()) as { rows: Array<{ action: string }> };
    assert.ok(payload.rows.some((row) => row.action === "studio_ops.degraded_mode_entered"));
  });
});

test("pilot dry-run endpoint returns plan for approved pilot capability", async () => {
  const pilotExecutor = {
    dryRun: () => ({
      actionType: "ops_note_append" as const,
      ownerUid: "owner-1",
      resourceCollection: "batches" as const,
      resourceId: "batch-1",
      notePreview: "preview",
    }),
    execute: async () => ({
      idempotencyKey: "k",
      proposalId: "p",
      replayed: false,
      resourcePointer: { collection: "studioBrainPilotOpsNotes", docId: "note-1" },
    }),
    rollback: async () => ({ ok: true as const, replayed: false }),
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
    const payload = (await created.json()) as { proposal?: { id: string } };
    const proposalId = String(payload.proposal?.id ?? "");
    const dryRun = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/dry-run`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(dryRun.status, 200);
  });
});

test("high-risk agent intake is blocked and routed to manual review", async () => {
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
    assert.equal(response.status, 403);
    const payload = (await response.json()) as { reasonCode: string; intakeId: string };
    assert.equal(payload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
    assert.ok(payload.intakeId.length > 5);

    const queue = await fetch(`${baseUrl}/api/intake/review-queue?limit=10`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(queue.status, 200);
    const queuePayload = (await queue.json()) as { rows: Array<{ intakeId: string; category: string }> };
    assert.ok(queuePayload.rows.length >= 1);
    assert.equal(queuePayload.rows[0].category, "ip_infringement");
  });
});

test("staff override granted allows previously blocked agent intake", async () => {
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
    const blockedPayload = (await createBlocked.json()) as { intakeId: string };
    assert.equal(createBlocked.status, 403);

    const grant = await fetch(`${baseUrl}/api/intake/review-queue/${blockedPayload.intakeId}/override`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({
        decision: "override_granted",
        reasonCode: "staff_override_context_verified",
        rationale: "Staff verified rights documentation and approved exception path.",
      }),
    });
    assert.equal(grant.status, 200);

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
    assert.equal(createAllowed.status, 201);
  });
});

test("ops degraded endpoint enforces auth and validates status values", async () => {
  await withServer({}, async (baseUrl) => {
    const nonStaff = await fetch(`${baseUrl}/api/ops/degraded`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-member" },
      body: JSON.stringify({
        status: "entered",
        mode: "offline",
      }),
    });
    assert.equal(nonStaff.status, 401);

    const invalidStatus = await fetch(`${baseUrl}/api/ops/degraded`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        status: "paused",
        mode: "offline",
      }),
    });
    assert.equal(invalidStatus.status, 400);
  });
});

test("ops degraded endpoint preserves mode metadata and supports audit prefix filtering", async () => {
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
    assert.equal(entered.status, 200);

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
    assert.equal(exited.status, 200);

    const audit = await fetch(`${baseUrl}/api/ops/audit?limit=20&actionPrefix=studio_ops.degraded_mode_`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(audit.status, 200);
    const payload = (await audit.json()) as {
      rows: Array<{
        action: string;
        metadata?: { status?: string; mode?: string };
      }>;
    };
    const enteredRow = payload.rows.find((row) => row.action === "studio_ops.degraded_mode_entered");
    const exitedRow = payload.rows.find((row) => row.action === "studio_ops.degraded_mode_exited");
    assert.ok(enteredRow);
    assert.ok(exitedRow);
    assert.equal(enteredRow?.metadata?.status, "entered");
    assert.equal(exitedRow?.metadata?.status, "exited");
    assert.equal(enteredRow?.metadata?.mode, "offline");
  });
});

test("ops audit and ops drills listing endpoints reject non-staff principals", async () => {
  await withServer({}, async (baseUrl) => {
    const audit = await fetch(`${baseUrl}/api/ops/audit?limit=10`, {
      headers: { authorization: "Bearer test-member" },
    });
    assert.equal(audit.status, 401);

    const drills = await fetch(`${baseUrl}/api/ops/drills?limit=10`, {
      headers: { authorization: "Bearer test-member" },
    });
    assert.equal(drills.status, 401);
  });
});

test("staff override denied keeps blocked intake denied on retry", async () => {
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
    assert.equal(createBlocked.status, 403);
    const blockedPayload = (await createBlocked.json()) as { intakeId: string; reasonCode: string };
    assert.equal(blockedPayload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
    assert.ok(blockedPayload.intakeId.length > 5);

    const deny = await fetch(`${baseUrl}/api/intake/review-queue/${blockedPayload.intakeId}/override`, {
      method: "POST",
      headers: { authorization: "Bearer test-staff", "content-type": "application/json" },
      body: JSON.stringify({
        decision: "override_denied",
        reasonCode: "policy_confirmed_block",
        rationale: "Staff denied request because rights proof is missing.",
      }),
    });
    assert.equal(deny.status, 200);

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
    assert.equal(createStillBlocked.status, 403);
    const stillBlockedPayload = (await createStillBlocked.json()) as { reasonCode: string };
    assert.equal(stillBlockedPayload.reasonCode, "BLOCKED_BY_INTAKE_POLICY");
  });
});

test("trust safety triage suggestion endpoints generate and track feedback", async () => {
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
    assert.equal(suggest.status, 200);
    const suggestPayload = (await suggest.json()) as { suggestion: { category: string; suggestionOnly: boolean } };
    assert.equal(suggestPayload.suggestion.suggestionOnly, true);
    assert.equal(suggestPayload.suggestion.category, "safety");

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
    assert.equal(feedback.status, 200);

    const stats = await fetch(`${baseUrl}/api/trust-safety/triage/stats?limit=100`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(stats.status, 200);
    const statsPayload = (await stats.json()) as { stats: { accepted: number; rejected: number } };
    assert.equal(statsPayload.stats.accepted, 1);
    assert.equal(statsPayload.stats.rejected, 0);
  });
});

test("proposal endpoint returns 429 when endpoint throttle exceeded and logs rate-limit event", async () => {
  await withServer(
    {
      endpointRateLimits: { createProposalPerMinute: 1 },
    },
    async (baseUrl) => {
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
      assert.equal(first.status, 201);

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
      assert.equal(second.status, 429);
      const payload = (await second.json()) as { reasonCode: string; retryAfterSeconds: number };
      assert.equal(payload.reasonCode, "RATE_LIMITED");
      assert.ok(payload.retryAfterSeconds > 0);

      const eventsResp = await fetch(`${baseUrl}/api/capabilities/rate-limits/events?limit=10`, {
        headers: { authorization: "Bearer test-staff" },
      });
      assert.equal(eventsResp.status, 200);
      const eventsPayload = (await eventsResp.json()) as { rows: Array<{ action: string }> };
      assert.ok(eventsPayload.rows.length >= 1);
      assert.ok(eventsPayload.rows.every((row) => row.action === "rate_limit_triggered"));
    }
  );
});

test("reopen rejected proposal requires admin role", async () => {
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
    const payload = (await created.json()) as { proposal: { id: string } };
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
    assert.equal(forbidden.status, 403);

    const reopened = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/reopen`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-admin" },
      body: JSON.stringify({ reason: "Need another review pass with updated context." }),
    });
    assert.equal(reopened.status, 200);
    const reopenedPayload = (await reopened.json()) as { proposal: { status: string } };
    assert.equal(reopenedPayload.proposal.status, "pending_approval");
  });
});

test("pilot write executes only after approval and supports replay semantics", async () => {
  const idempotencySeen = new Set<string>();
  const pilotExecutor = {
    dryRun: (input: Record<string, unknown>) => ({
      actionType: "ops_note_append" as const,
      ownerUid: String(input.ownerUid ?? "owner-1"),
      resourceCollection: "batches" as const,
      resourceId: String(input.resourceId ?? "batch-1"),
      notePreview: String(input.note ?? ""),
    }),
    execute: async (input: { idempotencyKey: string; proposalId: string }) => ({
      idempotencyKey: input.idempotencyKey,
      proposalId: input.proposalId,
      replayed: idempotencySeen.has(input.idempotencyKey),
      resourcePointer: {
        collection: "studioBrainPilotOpsNotes",
        docId: "note-1",
      },
    }),
    rollback: async () => ({ ok: true as const, replayed: false }),
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
    assert.ok(created.status === 200 || created.status === 201);
    const createdPayload = (await created.json()) as { proposal?: { id: string } };
    const proposalId = String(createdPayload.proposal?.id ?? "");
    assert.ok(proposalId.length > 0);

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
    assert.equal(deniedBeforeApproval.status, 409);

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        approvedBy: "staff-test-uid",
        rationale: "Approved for low-risk pilot note write.",
      }),
    });
    assert.equal(approved.status, 200);

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
    assert.equal(firstExecute.status, 200);
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
    assert.equal(replay.status, 409);
  });
});

test("execute denies cross-tenant actor on approved proposal", async () => {
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
    const createdPayload = (await created.json()) as { proposal?: { id: string } };
    const proposalId = String(createdPayload.proposal?.id ?? "");
    assert.ok(proposalId.length > 0);

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        approvedBy: "staff-test-uid",
        rationale: "Approved for tenant-scope denial verification.",
      }),
    });
    assert.equal(approved.status, 200);

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
    assert.equal(execute.status, 409);
    const payload = (await execute.json()) as { decision?: { reasonCode?: string } };
    assert.equal(payload.decision?.reasonCode, "TENANT_MISMATCH");
    const audit = await fetch(`${baseUrl}/api/ops/audit?limit=20&actionPrefix=studio_ops.cross_tenant_denied`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(audit.status, 200);
    const auditPayload = (await audit.json()) as { rows: Array<{ action: string }> };
    assert.ok(auditPayload.rows.some((row) => row.action === "studio_ops.cross_tenant_denied"));
  });
});

test("capabilities endpoint returns cockpit bootstrap payload", async () => {
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
    assert.equal(created.status, 201);
    const createdPayload = (await created.json()) as { proposal: { id: string } };

    const response = await fetch(`${baseUrl}/api/capabilities`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      ok: boolean;
      capabilities: Array<{ id: string }>;
      proposals: Array<{ id: string }>;
      policy: { killSwitch: { enabled: boolean }; exemptions: unknown[] };
      connectors: Array<{ id: string; ok: boolean }>;
    };

    assert.equal(payload.ok, true);
    assert.ok(payload.capabilities.some((row) => row.id === "firestore.batch.close"));
    assert.ok(payload.proposals.some((row) => row.id === createdPayload.proposal.id));
    assert.equal(typeof payload.policy.killSwitch.enabled, "boolean");
    assert.ok(Array.isArray(payload.policy.exemptions));
    assert.ok(Array.isArray(payload.connectors));
  });
});

test("pilot rollback endpoint forwards idempotency and reason to executor", async () => {
  const rollbackCalls: Array<{ proposalId: string; idempotencyKey: string; reason: string; actorUid: string }> = [];
  const pilotExecutor = {
    dryRun: (input: Record<string, unknown>) => ({
      actionType: "ops_note_append" as const,
      ownerUid: String(input.ownerUid ?? "owner-1"),
      resourceCollection: "batches" as const,
      resourceId: String(input.resourceId ?? "batch-1"),
      notePreview: String(input.note ?? ""),
    }),
    execute: async (input: { idempotencyKey: string; proposalId: string }) => ({
      idempotencyKey: input.idempotencyKey,
      proposalId: input.proposalId,
      replayed: false,
      resourcePointer: {
        collection: "studioBrainPilotOpsNotes",
        docId: "note-rollback-1",
      },
    }),
    rollback: async (input: { proposalId: string; idempotencyKey: string; reason: string; actorUid: string }) => {
      rollbackCalls.push(input);
      return { ok: true as const, replayed: false };
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
    assert.equal(created.status, 201);
    const createdPayload = (await created.json()) as { proposal: { id: string } };
    const proposalId = createdPayload.proposal.id;

    const approved = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        approvedBy: "staff-test-uid",
        rationale: "Approved pilot write before rollback validation.",
      }),
    });
    assert.equal(approved.status, 200);

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
    assert.equal(execute.status, 200);

    const rollback = await fetch(`${baseUrl}/api/capabilities/proposals/${proposalId}/rollback`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        idempotencyKey: "pilot-rb-001",
        reason: "Rollback requested after duplicate operator note.",
      }),
    });
    assert.equal(rollback.status, 200);
    const rollbackPayload = (await rollback.json()) as { ok: boolean };
    assert.equal(rollbackPayload.ok, true);

    assert.equal(rollbackCalls.length, 1);
    assert.equal(rollbackCalls[0].proposalId, proposalId);
    assert.equal(rollbackCalls[0].idempotencyKey, "pilot-rb-001");
    assert.equal(rollbackCalls[0].reason, "Rollback requested after duplicate operator note.");
    assert.equal(rollbackCalls[0].actorUid, "staff-test-uid");
  });
});

test("read-only memory endpoints allow staff auth without admin token when configured", async () => {
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
    assert.equal(captured.status, 201);

    const search = await fetch(`${baseUrl}/api/memory/search`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({ query: "startup continuity", limit: 5 }),
    });
    assert.equal(search.status, 200);

    const context = await fetch(`${baseUrl}/api/memory/context`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({ query: "startup continuity", maxItems: 3, maxChars: 512 }),
    });
    assert.equal(context.status, 200);

    const recent = await fetch(`${baseUrl}/api/memory/recent?limit=5`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(recent.status, 200);

    const stats = await fetch(`${baseUrl}/api/memory/stats`, {
      headers: { authorization: "Bearer test-staff" },
    });
    assert.equal(stats.status, 200);

    const captureBlocked = await fetch(`${baseUrl}/api/memory/capture`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
      body: JSON.stringify({
        content: "Decision: this write should stay admin-token gated.",
        source: "manual",
      }),
    });
    assert.equal(captureBlocked.status, 401);
  });
});

test("control tower state routes derive browser-friendly room and service data", async () => {
  const fixture = createControlTowerFixture();
  const { runner } = createControlTowerRunner();
  const stateStore = new MemoryStateStore();
  await stateStore.saveOverseerRun(buildSampleOverseerRun());

  try {
    await withServer(
      {
        stateStore,
        controlTowerRepoRoot: fixture.root,
        controlTowerRunner: runner,
      },
      async (baseUrl) => {
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
        assert.equal(startupHandoff.status, 201);

        const secretCapture = await fetch(`${baseUrl}/api/memory/capture`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: "Bearer test-staff" },
          body: JSON.stringify({
            content:
              "Operator note: Authorization: Bearer test-redaction-token",
            source: "manual",
          }),
        });
        assert.equal(secretCapture.status, 201);

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
        assert.equal(shadowMcpCapture.status, 201);

        const response = await fetch(`${baseUrl}/api/control-tower/state`, {
          headers: { authorization: "Bearer test-staff" },
        });
        assert.equal(response.status, 200);
        const payload = (await response.json()) as {
          ok: boolean;
          state: {
            overview: {
              activeRooms: Array<{ id: string }>;
              needsAttention: Array<{ title: string }>;
              goodNextMoves: Array<{ title: string }>;
            };
            pinnedItems: Array<{ title: string }>;
            services: Array<{ id: string; health: string }>;
            board: Array<{ owner: string; task: string }>;
            memoryBrief: {
              continuityState: string;
              goal: string;
              consolidation: {
                mode: string;
                focusAreas: string[];
                actionabilityStatus?: string | null;
                actionableInsightCount?: number | null;
                topActions?: string[];
              };
            };
            startupScorecard: {
              rubric: { overallScore: number | null; grade: string };
              metrics: { readyRate: number | null; groundingReadyRate: number | null; blockedContinuityRate: number | null; p95LatencyMs: number | null };
              supportingSignals: { toolcalls: { telemetryCoverageRate: number | null } };
              coverage: { gaps: string[] };
            } | null;
            memoryHealth: {
              severity: string;
              reviewBacklog: { reviewNow: number };
              conflictBacklog: { retrievalShadowedRows: number };
              startupReadiness: { startupEligibleRows: number; handoffRows: number };
              secretExposureFindings: { canonicalBlockedRows: number };
              shadowMcpFindings: { highRiskRows: number };
              highlights: string[];
            } | null;
            recentChanges: Array<{ type: string; sourceAction: string | null }>;
          };
        };

        assert.equal(payload.ok, true);
        assert.equal(payload.state.overview.activeRooms[0]?.id, "portal");
        assert.ok(payload.state.overview.needsAttention.length >= 1);
        assert.ok(payload.state.pinnedItems.some((entry) => entry.title === "Discord Relay is down"));
        assert.ok(payload.state.services.some((entry) => entry.id === "studio-brain-discord-relay" && entry.health === "error"));
        assert.equal(payload.state.board[0]?.owner, "Memory maintenance");
        assert.equal(payload.state.board[1]?.owner, "Codex");
        assert.match(payload.state.board[1]?.task ?? "", /Investigate portal issue/i);
        assert.equal(payload.state.memoryBrief.continuityState, "ready");
        assert.equal(payload.state.memoryBrief.consolidation.mode, "scheduled");
        assert.ok(payload.state.memoryBrief.consolidation.focusAreas.includes("Portal continuity"));
        assert.equal(payload.state.memoryBrief.consolidation.actionabilityStatus, "passed");
        assert.equal(payload.state.memoryBrief.consolidation.actionableInsightCount, 2);
        assert.deepEqual(payload.state.memoryBrief.consolidation.topActions?.slice(0, 2), [
          "Reuse the promoted approval summary memory as the canonical startup thread.",
          "Review and split the unknown mail-thread cluster before the next dream pass.",
        ]);
        assert.equal(payload.state.startupScorecard?.rubric.grade, "A");
        assert.equal(payload.state.startupScorecard?.rubric.overallScore, 98);
        assert.equal(payload.state.startupScorecard?.metrics.readyRate, 0.98);
        assert.equal(payload.state.startupScorecard?.metrics.groundingReadyRate, 0.97);
        assert.equal(payload.state.startupScorecard?.metrics.blockedContinuityRate, 0.01);
        assert.equal(payload.state.startupScorecard?.metrics.p95LatencyMs, 950);
        assert.equal(payload.state.startupScorecard?.supportingSignals.toolcalls.telemetryCoverageRate, 0.86);
        assert.equal(payload.state.startupScorecard?.coverage.gaps.length, 1);
        assert.equal(payload.state.memoryHealth?.severity, "critical");
        assert.equal((payload.state.memoryHealth?.startupReadiness.startupEligibleRows ?? 0) >= 1, true);
        assert.equal((payload.state.memoryHealth?.startupReadiness.handoffRows ?? 0) >= 1, true);
        assert.equal((payload.state.memoryHealth?.secretExposureFindings.canonicalBlockedRows ?? 0) >= 1, true);
        assert.equal((payload.state.memoryHealth?.shadowMcpFindings.highRiskRows ?? 0) >= 1, true);
        assert.equal(
          Object.prototype.hasOwnProperty.call(payload.state.memoryHealth?.conflictBacklog ?? {}, "retrievalShadowedRows"),
          true,
        );
        assert.equal(
          (payload.state.memoryHealth?.highlights ?? []).some((entry) =>
            /secret-bearing memories|shadowed by hard conflict retrieval rules/i.test(entry)
          ),
          true,
        );
        assert.equal(
          payload.state.overview.goodNextMoves.some((entry) =>
            /promoted approval summary memory/i.test(entry.title)
          ),
          false,
        );
        assert.equal(
          payload.state.overview.goodNextMoves.some((entry) =>
            /audit mcp governance coverage in memory|review quarantined secret-bearing memories/i.test(entry.title)
          ),
          true,
        );
        assert.equal(
          payload.state.overview.needsAttention.some((entry) =>
            /secret-bearing memories need review|shadow mcp memory needs governance review/i.test(entry.title)
          ),
          true,
        );
        assert.ok(payload.state.recentChanges.some((entry) => entry.type === "memory.promoted"));
        assert.ok(payload.state.recentChanges.some((entry) => entry.sourceAction === "control_tower.memory_consolidation"));

        const roomResponse = await fetch(`${baseUrl}/api/control-tower/rooms/portal`, {
          headers: { authorization: "Bearer test-staff" },
        });
        assert.equal(roomResponse.status, 200);
        const roomPayload = (await roomResponse.json()) as {
          ok: boolean;
          room: { id: string; attach: { sessionName: string; sshCommand: string } | null };
        };
        assert.equal(roomPayload.ok, true);
        assert.equal(roomPayload.room.id, "portal");
        assert.equal(roomPayload.room.attach?.sessionName, "sb-room");
        assert.match(roomPayload.room.attach?.sshCommand ?? "", /ssh -t studiobrain/);
      },
    );
  } finally {
    fixture.cleanup();
  }
});

test("kiln endpoints require staff auth", async () => {
  const kilnStore = new MemoryKilnStore();
  await kilnStore.upsertKiln(buildKiln());

  await withServer(
    {
      kilnEnabled: true,
      kilnStore,
      artifactStore: createMemoryArtifactStore(),
    },
    async (baseUrl) => {
      const unauth = await fetch(`${baseUrl}/api/kiln/overview`);
      assert.equal(unauth.status, 401);

      const nonStaff = await fetch(`${baseUrl}/kiln-command`, {
        headers: { authorization: "Bearer test-member" },
      });
      assert.equal(nonStaff.status, 401);
    },
  );
});

test("kiln upload, detail, and artifact download routes preserve observed evidence", async () => {
  const kilnStore = new MemoryKilnStore();
  const artifactStore = createMemoryArtifactStore();
  const content = readKilnFixture("synthetic-single-zone.txt");

  await withServer(
    {
      kilnEnabled: true,
      kilnStore,
      artifactStore,
    },
    async (baseUrl) => {
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
      assert.equal(upload.status, 201);
      const uploadPayload = (await upload.json()) as {
        ok: boolean;
        result: {
          kiln: { id: string };
          firingRun: { id: string };
          artifact: { id: string };
        };
      };
      assert.equal(uploadPayload.ok, true);

      const kilnDetail = await fetch(
        `${baseUrl}/api/kiln/kilns/${encodeURIComponent(uploadPayload.result.kiln.id)}`,
        { headers: { authorization: "Bearer test-staff" } },
      );
      assert.equal(kilnDetail.status, 200);

      const runDetail = await fetch(
        `${baseUrl}/api/kiln/runs/${encodeURIComponent(uploadPayload.result.firingRun.id)}`,
        { headers: { authorization: "Bearer test-staff" } },
      );
      assert.equal(runDetail.status, 200);
      const runPayload = (await runDetail.json()) as {
        ok: boolean;
        detail: { telemetry: Array<{ tempPrimary: number | null }> };
      };
      assert.equal(runPayload.ok, true);
      assert.equal(runPayload.detail.telemetry.length, 2);

      const artifactResponse = await fetch(
        `${baseUrl}/api/kiln/artifacts/${encodeURIComponent(uploadPayload.result.artifact.id)}/content`,
        { headers: { authorization: "Bearer test-staff" } },
      );
      assert.equal(artifactResponse.status, 200);
      assert.equal(await artifactResponse.text(), content.toString("utf8"));
    },
  );
});

test("kiln upload enforces decoded artifact byte limits", async () => {
  const kilnStore = new MemoryKilnStore();
  const artifactStore = createMemoryArtifactStore();
  const baseContent = readKilnFixture("synthetic-single-zone.txt");
  const content = Buffer.concat(Array.from({ length: 32 }, () => baseContent));

  await withServer(
    {
      kilnEnabled: true,
      kilnStore,
      artifactStore,
      kilnImportMaxBytes: 4_096,
    },
    async (baseUrl) => {
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
      assert.equal(response.status, 413);
      const payload = (await response.json()) as { ok: boolean; message: string };
      assert.equal(payload.ok, false);
      assert.match(payload.message, /exceeds/i);
    },
  );
});

test("kiln command page keeps control posture honest for human-triggered starts", async () => {
  const kilnStore = new MemoryKilnStore();
  const artifactStore = createMemoryArtifactStore();
  await kilnStore.upsertKiln(buildKiln());
  const run = await createFiringRun(kilnStore, {
    kilnId: "kiln_test",
    requestedBy: "staff-test-uid",
    programName: "Cone 6 Glaze",
    queueState: "ready_for_start",
  });
  await recordOperatorAction(kilnStore, {
    kilnId: run.kilnId,
    firingRunId: run.id,
    actionType: "loaded_kiln",
    requestedBy: "staff-test-uid",
    enableSupportedWrites: false,
  });
  await recordOperatorAction(kilnStore, {
    kilnId: run.kilnId,
    firingRunId: run.id,
    actionType: "verified_clearance",
    requestedBy: "staff-test-uid",
    enableSupportedWrites: false,
  });
  await recordOperatorAction(kilnStore, {
    kilnId: run.kilnId,
    firingRunId: run.id,
    actionType: "pressed_start",
    requestedBy: "staff-test-uid",
    confirmedBy: "staff-test-uid",
    enableSupportedWrites: false,
  });

  await withServer(
    {
      kilnEnabled: true,
      kilnStore,
      artifactStore,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/kiln-command`, {
        headers: { authorization: "Bearer test-staff" },
      });
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /Genesis remains the control authority/i);
      assert.match(html, /Human-triggered/);
      assert.doesNotMatch(html, /Supported write path/);
    },
  );
});

test("kiln overview reflects imported telemetry and honest observed posture", async () => {
  const kilnStore = new MemoryKilnStore();
  const artifactStore = createMemoryArtifactStore();
  await importGenesisArtifact({
    artifactStore,
    kilnStore,
    filename: "synthetic-three-zone.txt",
    content: readKilnFixture("synthetic-three-zone.txt"),
    source: "manual_upload",
  });

  await withServer(
    {
      kilnEnabled: true,
      kilnStore,
      artifactStore,
    },
    async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/kiln/overview`, {
        headers: { authorization: "Bearer test-staff" },
      });
      assert.equal(response.status, 200);
      const payload = (await response.json()) as {
        ok: boolean;
        overview: { kilns: Array<{ controlPosture: string; currentTemp: number | null }> };
      };
      assert.equal(payload.ok, true);
      assert.equal(payload.overview.kilns.length, 1);
      assert.equal(payload.overview.kilns[0]?.controlPosture, "Observed only");
      assert.equal(payload.overview.kilns[0]?.currentTemp, 2231);
    },
  );
});

test("control tower promotes memory next moves only when startup quality is degraded", async () => {
  const fixture = createControlTowerFixture();
  const { runner } = createControlTowerRunner();
  const stateStore = new MemoryStateStore();
  await stateStore.saveOverseerRun(buildSampleOverseerRun());

  writeFileSync(
    join(fixture.root, "output", "qa", "codex-startup-scorecard.json"),
    `${JSON.stringify(
      {
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
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  try {
    await withServer(
      {
        stateStore,
        controlTowerRepoRoot: fixture.root,
        controlTowerRunner: runner,
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/control-tower/state`, {
          headers: { authorization: "Bearer test-staff" },
        });
        assert.equal(response.status, 200);
        const payload = (await response.json()) as {
          ok: boolean;
          state: {
            overview: { goodNextMoves: Array<{ title: string; actionLabel: string }> };
            startupScorecard: { rubric: { grade: string } } | null;
          };
        };

        assert.equal(payload.ok, true);
        assert.equal(payload.state.startupScorecard?.rubric.grade, "F");
        assert.equal(
          payload.state.overview.goodNextMoves.some((entry) =>
            /promoted approval summary memory/i.test(entry.title)
          ),
          true,
        );
        assert.equal(
          payload.state.overview.goodNextMoves.some((entry) => entry.actionLabel === "Review memory"),
          true,
        );
      },
    );
  } finally {
    fixture.cleanup();
  }
});

test("control tower actions send room instructions, persist room escalation, and run service actions", async () => {
  const fixture = createControlTowerFixture();
  const { runner, sentTexts, serviceActions } = createControlTowerRunner();
  const stateStore = new MemoryStateStore();
  await stateStore.saveOverseerRun(buildSampleOverseerRun());

  try {
    await withServer(
      {
        stateStore,
        controlTowerRepoRoot: fixture.root,
        controlTowerRunner: runner,
      },
      async (baseUrl) => {
        const authHeaders = {
          authorization: "Bearer test-staff",
          "content-type": "application/json",
        };

        const sendResponse = await fetch(`${baseUrl}/api/control-tower/rooms/portal/send`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ text: "status?" }),
        });
        assert.equal(sendResponse.status, 200);
        assert.equal(sentTexts[0]?.session, "sb-room");
        assert.equal(sentTexts[0]?.text, "status?");

        const pinResponse = await fetch(`${baseUrl}/api/control-tower/rooms/portal/pin`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ rationale: "Needs operator review." }),
        });
        assert.equal(pinResponse.status, 200);

        const stateResponse = await fetch(`${baseUrl}/api/control-tower/state`, {
          headers: { authorization: "Bearer test-staff" },
        });
        const statePayload = (await stateResponse.json()) as {
          state: { rooms: Array<{ id: string; isEscalated: boolean }> };
        };
        assert.equal(statePayload.state.rooms.find((entry) => entry.id === "portal")?.isEscalated, true);

        const serviceResponse = await fetch(`${baseUrl}/api/control-tower/services/studio-brain-discord-relay/actions`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ action: "restart" }),
        });
        assert.equal(serviceResponse.status, 200);
        assert.deepEqual(serviceActions[0], { service: "studio-brain-discord-relay", action: "restart" });

        const ackResponse = await fetch(`${baseUrl}/api/control-tower/overseer/ack`, {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ note: "Reviewed and queued." }),
        });
        assert.equal(ackResponse.status, 200);

        const eventsResponse = await fetch(`${baseUrl}/api/control-tower/events`, {
          headers: { authorization: "Bearer test-staff" },
        });
        assert.equal(eventsResponse.status, 200);
        const eventsPayload = (await eventsResponse.json()) as {
          events: Array<{ sourceAction: string | null; type: string; payload?: Record<string, unknown> }>;
        };
        assert.ok(eventsPayload.events.some((entry) => entry.sourceAction === "studio_ops.control_tower.session_instruction_sent"));
        assert.ok(eventsPayload.events.some((entry) => entry.sourceAction === "studio_ops.control_tower.room_pinned"));
        assert.ok(eventsPayload.events.some((entry) => entry.sourceAction === "studio_ops.control_tower.service_action"));
        assert.ok(eventsPayload.events.some((entry) => entry.sourceAction === "studio_ops.control_tower.overseer_ack"));
        assert.ok(eventsPayload.events.some((entry) => entry.sourceAction === "control_tower.memory_brief" && entry.type === "memory.promoted"));
        assert.ok(
          eventsPayload.events.some(
            (entry) =>
              entry.sourceAction === "control_tower.memory_consolidation" &&
              entry.type === "memory.promoted" &&
              entry.payload?.mode === "scheduled",
          ),
        );

        const sseResponse = await fetch(`${baseUrl}/api/control-tower/events?stream=1&once=1`, {
          headers: {
            authorization: "Bearer test-staff",
            accept: "text/event-stream",
          },
        });
        assert.equal(sseResponse.status, 200);
        const sseText = await sseResponse.text();
        assert.match(sseText, /event:\s+memory\.promoted/);
        assert.match(sseText, /control_tower\.memory_consolidation/);
      },
    );
  } finally {
    fixture.cleanup();
  }
});
