/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";
import * as controlTowerUtils from "../../utils/studioBrainControlTower";
import StudioBrainControlTowerModule from "./StudioBrainControlTowerModule";

function createUser(): User {
  return {
    uid: "staff-uid",
    getIdToken: vi.fn(async () => "test-id-token"),
  } as unknown as User;
}

function createStatePayload() {
  return {
    ok: true,
    state: {
      generatedAt: "2026-03-30T10:00:00.000Z",
      theme: {
        name: "desert-night",
        label: "Desert Night",
        colorMode: "dark",
        motionLevel: "calm",
        highContrast: false,
        refreshMode: "diff-only",
      },
      ops: {
        overallStatus: "waiting",
        heartbeatStatus: "pass",
        postureStatus: "warn",
        overseerStatus: "warning",
        summary: "Two operator follow-ups are waiting.",
        latestRunId: "ovr-1",
      },
      alerts: [],
      pinnedItems: [
        {
          id: "studio-brain-discord-relay",
          title: "Discord Relay is down",
          detail: "Discord Relay is inactive.",
          status: "pinned",
          actionHint: "Check Discord Relay status and restart if safe.",
        },
      ],
      services: [
        {
          id: "studio-brain-discord-relay",
          label: "Discord Relay",
          health: "error",
          impact: "Operator notifications and Discord delivery may fail.",
          recentChanges: "Discord Relay is inactive.",
          changedAt: "2026-03-30T09:55:00.000Z",
          summary: "Discord Relay is inactive.",
          actions: [
            { id: "studio-brain-discord-relay:status", label: "Refresh status", verb: "status", requiresConfirmation: false },
          ],
        },
      ],
      rooms: [
        {
          id: "portal",
          name: "portal",
          project: "monsoonfire-portal",
          cwd: "/home/wuff/monsoonfire-portal",
          tool: "Codex",
          status: "waiting",
          objective: "Investigate the current portal issue.",
          lastActivityAt: "2026-03-30T09:58:00.000Z",
          ageMinutes: 2,
          isEscalated: false,
          nextActions: [
            {
              id: "room:portal:nudge",
              title: "Send direction to portal",
              why: "This room is ready for an operator nudge.",
              ageMinutes: 2,
              actionLabel: "Send instruction",
              target: { type: "room", roomId: "portal" },
            },
          ],
          sessionNames: ["sb-room"],
          summary: "1 lane in portal.",
        },
      ],
      events: [
        {
          id: "event-1",
          at: "2026-03-30T09:59:00.000Z",
          occurredAt: "2026-03-30T09:59:00.000Z",
          kind: "operator",
          type: "task.updated",
          severity: "warning",
          title: "Room waiting",
          summary: "Portal room needs direction.",
          actor: "staff-uid",
          roomId: "portal",
          serviceId: null,
          actionLabel: "Inspect room",
          sourceAction: "studio_ops.control_tower.room_pinned",
          payload: {},
        },
      ],
      recentChanges: [
        {
          id: "event-1",
          at: "2026-03-30T09:59:00.000Z",
          occurredAt: "2026-03-30T09:59:00.000Z",
          kind: "operator",
          type: "task.updated",
          severity: "warning",
          title: "Room waiting",
          summary: "Portal room needs direction.",
          actor: "staff-uid",
          roomId: "portal",
          serviceId: null,
          actionLabel: "Inspect room",
          sourceAction: "studio_ops.control_tower.room_pinned",
          payload: {},
        },
      ],
      board: [
        {
          id: "board:portal",
          owner: "Codex",
          task: "Investigate the current portal issue.",
          state: "waiting",
          blocker: "",
          next: "Inspect portal",
          last_update: "2026-03-30T09:58:00.000Z",
          roomId: "portal",
          sessionName: "sb-room",
          contactReason: "Studio Brain verified the portal lane and is asking for one owner decision before it keeps moving.",
          verifiedContext: ["Portal lane needs direction.", "Operator direction is still pending."],
          decisionNeeded: "Decide whether to keep the portal lane active or pause it.",
        },
      ],
      channels: [
        {
          id: "channel:sb-room",
          label: "portal",
          channel: "codex",
          owner: "Codex",
          state: "waiting",
          objective: "Investigate the current portal issue.",
          blocker: "",
          next: "Provide operator direction",
          lastUpdate: "2026-03-30T09:58:00.000Z",
          roomId: "portal",
          sessionName: "sb-room",
        },
      ],
      approvals: [
        {
          id: "approval-1",
          capabilityId: "firestore.batch.close",
          summary: "Close the test kiln batch.",
          requestedBy: "staff-uid",
          status: "pending_approval",
          createdAt: "2026-03-30T09:57:00.000Z",
          owner: "Studio Ops",
          approvalMode: "required",
          risk: "high",
          target: { type: "ops", action: "approvals" },
        },
      ],
      memoryBrief: {
        schema: "studio-brain.memory-brief.v1",
        generatedAt: "2026-03-30T10:00:00.000Z",
        continuityState: "ready",
        summary: "Portal issue is the main focus and the next safe move is inspection.",
        goal: "Investigate the current portal issue.",
        blockers: ["Operator direction is still pending."],
        recentDecisions: ["Portal lane stayed active in the control tower."],
        recommendedNextActions: ["Inspect portal"],
        fallbackSources: ["output/ops-cockpit/operator-state.json"],
        sourcePath: "output/studio-brain/memory-brief/latest.json",
        layers: {
          coreBlocks: ["Investigate the current portal issue."],
          workingMemory: ["Portal lane needs direction."],
          episodicMemory: ["Portal lane stayed active in the control tower."],
          canonicalMemory: ["accepted corpus artifacts"],
        },
        consolidation: {
          mode: "scheduled",
          status: "success",
          summary: "Offline consolidation is queued for the next quiet window.",
          lastRunAt: "2026-03-30T03:00:00.000Z",
          nextRunAt: "2026-03-31T03:00:00.000Z",
          focusAreas: ["Portal continuity", "Pending operator direction"],
          maintenanceActions: ["Dedupe overlap", "Reconnect incidents to artifacts"],
          outputs: [
            "output/studio-brain/memory-brief/latest.json",
            "output/memory/<overnight-run>/overnight-status.json",
          ],
          counts: {
            promotions: 2,
            archives: 1,
            quarantines: 0,
            repairedLinks: 3,
          },
          actionabilityStatus: "passed",
          actionableInsightCount: 2,
          suppressedConnectionNoteCount: 1,
          suppressedPseudoDecisionCount: 0,
          topActions: [
            "Reuse the promoted approval summary memory as the canonical startup thread.",
            "Review and split the unknown mail-thread cluster before the next dream pass.",
          ],
          lastError: null,
        },
      },
      startupScorecard: {
        schema: "codex-startup-scorecard.v1",
        sourcePath: "output/qa/codex-startup-scorecard.json",
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
        rubric: {
          overallScore: 98,
          grade: "A",
        },
        recommendations: [
          "Startup quality is within the current thresholds; keep collecting history so future regressions are easier to spot.",
        ],
      },
      partner: {
        schema: "studio-brain.partner-brief.v1",
        generatedAt: "2026-03-30T10:03:00.000Z",
        persona: {
          id: "wuff-chief-of-staff",
          displayName: "Studio Brain Chief of Staff",
          relationshipModel: "chief_of_staff",
          proactivity: "active",
          primarySurface: "codex_desktop_thread",
          sourceOfTruth: "control_tower",
          toneTraits: ["proactive", "concise", "initiative-taking", "not chatty"],
          summary: "An owner-facing operating partner that keeps initiative bounded.",
        },
        summary: "Studio Brain verified the portal lane and is asking for one owner decision before it keeps moving.",
        initiativeState: "waiting_on_owner",
        lastMeaningfulContactAt: "2026-03-30T10:02:00.000Z",
        nextCheckInAt: "2026-03-30T12:00:00.000Z",
        cooldownUntil: null,
        needsOwnerDecision: true,
        contactReason: "Studio Brain verified the portal lane and is asking for one owner decision before it keeps moving.",
        verifiedContext: [
          "Portal issue is the main focus and the next safe move is inspection.",
          "Operator direction is still pending.",
          "Portal lane stayed active in the control tower.",
        ],
        singleDecisionNeeded: "Decide whether to keep the portal lane active or pause it.",
        recommendedFocus: "Decide whether to keep the portal lane active or pause it.",
        dailyNote: "Studio Brain is tracking 1 bounded open loop. Recommended focus: decide whether to keep the portal lane active or pause it.",
        openLoops: [
          {
            id: "room:portal",
            title: "Portal lane waiting on decision",
            status: "open",
            summary: "Portal room is waiting on a bounded operator decision.",
            next: "Inspect portal",
            source: "control-tower-room:portal",
            updatedAt: "2026-03-30T09:58:00.000Z",
            roomId: "portal",
            sessionName: "sb-room",
            decisionNeeded: "Decide whether to keep the portal lane active or pause it.",
            verifiedContext: ["Portal lane needs direction.", "Portal lane stayed active in the control tower."],
            evidence: ["monsoonfire-portal", "Codex", "sb-room"],
          },
        ],
        idleBudget: {
          policy: "one_task_at_a_time",
          maxConcurrentTasks: 1,
          maxAttemptsPerLoop: 2,
          rankedBacklog: ["stale blocker cleanup", "unresolved review queues", "memory hygiene"],
          verifyBeforeReport: true,
          contactOnlyOnMeaningfulChange: true,
        },
        programs: [
          {
            id: "daily_brief",
            label: "Daily Brief",
            trigger: "Scheduled morning or first meaningful operator touchpoint of the day.",
            scope: "Summarize real Control Tower state, open loops, and one recommended focus.",
            approvalGate: "No approval required for summaries that do not trigger external writes.",
            escalationRule: "Escalate only if the brief contains a blocker, approval, or drift that needs owner review.",
            cooldown: "At most one full morning brief per day unless the state changes materially.",
            stopCondition: "Stop after one bounded brief is delivered and recorded.",
          },
        ],
        collaborationCommands: [
          { command: "pause", description: "Quiet the chief-of-staff loop." },
          { command: "redirect", description: "Redirect the current initiative without losing continuity." },
          { command: "why this", description: "Ask why Studio Brain chose the current interruption." },
          { command: "continue", description: "Resume the bounded loop with the current context." },
        ],
        artifacts: {
          latestBriefPath: "output/studio-brain/partner/latest-brief.json",
          checkinsPath: "output/studio-brain/partner/checkins.jsonl",
          openLoopsPath: "output/studio-brain/partner/open-loops.json",
        },
      },
      actions: [],
      overview: {
        needsAttention: [
          {
            id: "attention-1",
            title: "Portal room needs direction",
            why: "No recent instruction has been sent.",
            ageMinutes: 2,
            severity: "warning",
            actionLabel: "Inspect room",
            target: { type: "room", roomId: "portal" },
          },
        ],
        activeRooms: [
          {
            id: "portal",
            name: "portal",
            project: "monsoonfire-portal",
            cwd: "/home/wuff/monsoonfire-portal",
            tool: "Codex",
            status: "waiting",
            objective: "Investigate the current portal issue.",
            lastActivityAt: "2026-03-30T09:58:00.000Z",
            ageMinutes: 2,
            isEscalated: false,
            nextActions: [],
            sessionNames: ["sb-room"],
            summary: "1 lane in portal.",
          },
        ],
        goodNextMoves: [
          {
            id: "next-1",
            title: "Inspect portal",
            why: "This room looks ready for guidance.",
            ageMinutes: 2,
            actionLabel: "Inspect room",
            target: { type: "room", roomId: "portal" },
          },
        ],
        recentEvents: [],
      },
      counts: {
        needsAttention: 1,
        working: 0,
        waiting: 1,
        blocked: 1,
        escalated: 1,
      },
      sources: {
        operatorStatePath: "output/ops-cockpit/operator-state.json",
        heartbeatPath: "output/stability/heartbeat-summary.json",
        overseerPath: "output/overseer/latest.json",
        ackLogPath: "output/overseer/discord/acks.jsonl",
      },
      eventStream: {
        endpoint: "/api/control-tower/events",
        transport: "sse",
        heartbeatMs: 15000,
      },
      controlPlanes: {
        mcp: "Profile-gated tool and data plane.",
        agentBus: "Redis Streams handoff/event plane.",
        operatorUi: "Control Tower snapshot plus SSE operator plane.",
      },
    },
  };
}

function createRoomPayload() {
  return {
    ok: true,
    room: {
      id: "portal",
      name: "portal",
      project: "monsoonfire-portal",
      cwd: "/home/wuff/monsoonfire-portal",
      tool: "Codex",
      status: "waiting",
      objective: "Investigate the current portal issue.",
      lastActivityAt: "2026-03-30T09:58:00.000Z",
      ageMinutes: 2,
      isEscalated: false,
      nextActions: [],
      sessionNames: ["sb-room"],
      summary: "1 lane in portal.",
      room: {
        id: "portal",
        label: "portal",
        repo: "monsoonfire-portal",
        mood: "waiting",
        summary: "1 lane in portal.",
        sessions: [],
      },
      sessions: [
        {
          sessionName: "sb-room",
          rootSession: false,
          attached: false,
          lastActivityAt: "2026-03-30T09:58:00.000Z",
          paneCount: 1,
          windowCount: 1,
          cwd: "/home/wuff/monsoonfire-portal",
          repo: "monsoonfire-portal",
          tool: "codex",
          room: "portal",
          status: "waiting",
          statusLabel: "WAIT",
          objective: "Investigate the current portal issue.",
          summary: "Portal lane",
          panes: [],
        },
      ],
      recentEvents: [
        {
          id: "event-1",
          at: "2026-03-30T09:59:00.000Z",
          occurredAt: "2026-03-30T09:59:00.000Z",
          kind: "operator",
          type: "task.updated",
          severity: "warning",
          title: "Room waiting",
          summary: "Portal room needs direction.",
          actor: "staff-uid",
          roomId: "portal",
          serviceId: null,
          actionLabel: "Inspect room",
          sourceAction: "studio_ops.control_tower.room_pinned",
          payload: {},
        },
      ],
      attach: {
        sessionName: "sb-room",
        sshCommand: "ssh -t studiobrain \"tmux attach -t sb-room\"",
        remoteCommand: "tmux attach -t sb-room",
      },
    },
  };
}

afterEach(() => {
  window.localStorage.clear();
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("StudioBrainControlTowerModule", () => {
  it("renders control tower overview and opens a room drawer", async () => {
    vi.spyOn(controlTowerUtils, "subscribeControlTowerEvents").mockReturnValue(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname === "/api/control-tower/state") {
        return new Response(JSON.stringify(createStatePayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "GET" && url.pathname === "/api/control-tower/rooms/portal") {
        return new Response(JSON.stringify(createRoomPayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "POST" && url.pathname === "/api/control-tower/rooms/portal/send") {
        return new Response(JSON.stringify({ ok: true, sessionName: "sb-room" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <StudioBrainControlTowerModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken=""
        onNavigateTarget={() => undefined}
      />,
    );

    expect(await screen.findByText("30-second operator plane")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Chief of staff" })).toBeTruthy();
    expect(screen.getByText("Owner commands")).toBeTruthy();
    expect(screen.getByText("Why this contact")).toBeTruthy();
    expect(screen.getByText("Portal lane waiting on decision")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Continuity brief" })).toBeTruthy();
    expect(screen.getByText("Next memory actions")).toBeTruthy();
    expect(screen.getByText("Startup quality")).toBeTruthy();
    expect(screen.getByText("No extra memory action is needed right now.")).toBeTruthy();
    expect(screen.getByText("ready rate: 98%")).toBeTruthy();
    expect(screen.getByText("telemetry coverage: 86%")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "30-second operator board" })).toBeTruthy();
    expect(screen.getByText("Offline consolidation")).toBeTruthy();
    expect(screen.getByText("promotions: 2")).toBeTruthy();
    expect(screen.getAllByText("Needs Attention").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active Rooms").length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Service oversight" })).toBeTruthy();

    fireEvent.click(screen.getAllByRole("button", { name: "Inspect room" })[0]);

    expect(await screen.findByRole("dialog", { name: "portal details" })).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText(/Ask the lane/i), {
      target: { value: "Give me your blocker." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send to room" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/control-tower/rooms/portal/send"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("surfaces memory actions when startup quality is degraded", async () => {
    vi.spyOn(controlTowerUtils, "subscribeControlTowerEvents").mockReturnValue(() => undefined);
    const degradedPayload = createStatePayload();
    degradedPayload.state.memoryBrief.continuityState = "continuity_degraded";
    degradedPayload.state.memoryBrief.consolidation.actionabilityStatus = "repair";
    degradedPayload.state.startupScorecard = {
      ...degradedPayload.state.startupScorecard,
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
      coverage: { gaps: [] },
      rubric: {
        overallScore: 61,
        grade: "F",
      },
      recommendations: ["Restore startup continuity before repo exploration."],
    };

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname === "/api/control-tower/state") {
        return new Response(JSON.stringify(degradedPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <StudioBrainControlTowerModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken=""
        onNavigateTarget={() => undefined}
      />,
    );

    expect(await screen.findByText("Next memory actions")).toBeTruthy();
    expect(screen.getByText("Reuse the promoted approval summary memory as the canonical startup thread.")).toBeTruthy();
    expect(screen.getByText("Review and split the unknown mail-thread cluster before the next dream pass.")).toBeTruthy();
    expect(screen.getByText("blocked continuity: 25%")).toBeTruthy();
    expect(screen.getByText("avg pre-start repo reads: 2")).toBeTruthy();
  });

  it("sends chief-of-staff commands and open-loop updates through bounded partner routes", async () => {
    vi.spyOn(controlTowerUtils, "subscribeControlTowerEvents").mockReturnValue(() => undefined);
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname === "/api/control-tower/state") {
        return new Response(JSON.stringify(createStatePayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "POST" && url.pathname === "/api/control-tower/partner/checkins") {
        return new Response(JSON.stringify({ ok: true, partner: createStatePayload().state.partner }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      if (method === "POST" && url.pathname === "/api/control-tower/partner/open-loops/room%3Aportal") {
        return new Response(
          JSON.stringify({
            ok: true,
            partner: createStatePayload().state.partner,
            openLoop: createStatePayload().state.partner.openLoops[0],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      }

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <StudioBrainControlTowerModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken=""
        onNavigateTarget={() => undefined}
      />,
    );

    expect(await screen.findByRole("heading", { name: "Chief of staff" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/control-tower/partner/checkins"),
        expect.objectContaining({ method: "POST" }),
      );
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Redirect" })[0]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/control-tower/partner/open-loops/room%3Aportal"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("accepts a runtime Studio Brain base URL override and loads the tower without a rebuild", async () => {
    vi.spyOn(controlTowerUtils, "subscribeControlTowerEvents").mockReturnValue(() => undefined);
    const resolutionSpy = vi
      .spyOn(controlTowerUtils, "getStudioBrainControlTowerResolution")
      .mockImplementation(() => {
        const storedBaseUrl = window.localStorage.getItem("mf:studio-brain-base-url") || "";
        if (!storedBaseUrl.trim()) {
          return {
            baseUrl: "",
            configured: false,
            enabled: false,
            reason: "Studio Brain base URL is not configured.",
          };
        }
        return {
          baseUrl: storedBaseUrl,
          configured: true,
          enabled: true,
          reason: "",
        };
      });

    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.pathname === "/api/control-tower/state") {
        return new Response(JSON.stringify(createStatePayload()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    render(
      <StudioBrainControlTowerModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken=""
        onNavigateTarget={() => undefined}
      />,
    );

    expect(await screen.findByText("Control Tower is waiting on the Studio Brain bridge")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Studio Brain base URL"), {
      target: { value: "https://studio-brain.runtime.example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save URL" }));

    expect(await screen.findByText("30-second operator plane")).toBeTruthy();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("https://studio-brain.runtime.example/api/control-tower/state"),
        expect.objectContaining({ method: "GET" }),
      );
    });
    expect(resolutionSpy).toHaveBeenCalled();
  });

  it("stops fallback polling once the stream is live", async () => {
    vi.useFakeTimers();
    vi.spyOn(controlTowerUtils, "getStudioBrainControlTowerResolution").mockReturnValue({
      baseUrl: "https://studio-brain.runtime.example",
      configured: true,
      enabled: true,
      reason: "",
    });
    const fetchStateSpy = vi
      .spyOn(controlTowerUtils, "fetchControlTowerState")
      .mockResolvedValue(createStatePayload().state);
    vi.spyOn(controlTowerUtils, "subscribeControlTowerEvents").mockImplementation((options) => {
      options.onOpen?.();
      return () => undefined;
    });

    render(
      <StudioBrainControlTowerModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken=""
        onNavigateTarget={() => undefined}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("30-second operator plane")).toBeTruthy();
    expect(fetchStateSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(6_000);
      await Promise.resolve();
    });

    expect(fetchStateSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps polling when the stream falls back", async () => {
    vi.useFakeTimers();
    vi.spyOn(controlTowerUtils, "getStudioBrainControlTowerResolution").mockReturnValue({
      baseUrl: "https://studio-brain.runtime.example",
      configured: true,
      enabled: true,
      reason: "",
    });
    const fetchStateSpy = vi
      .spyOn(controlTowerUtils, "fetchControlTowerState")
      .mockResolvedValue(createStatePayload().state);
    vi.spyOn(controlTowerUtils, "subscribeControlTowerEvents").mockImplementation((options) => {
      options.onError?.(new Error("stream offline"));
      return () => undefined;
    });

    render(
      <StudioBrainControlTowerModule
        user={createUser()}
        active={true}
        disabled={false}
        adminToken=""
        onNavigateTarget={() => undefined}
      />,
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByText("30-second operator plane")).toBeTruthy();
    expect(fetchStateSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      vi.advanceTimersByTime(6_000);
      await Promise.resolve();
    });

    expect(fetchStateSpy).toHaveBeenCalledTimes(3);
  });
});
