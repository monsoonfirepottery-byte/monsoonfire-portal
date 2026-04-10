import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendOverseerAck,
  collectCockpitState,
  renderRecoveryPanel,
  runServiceAction,
  sendToSession,
  spawnSession,
} from "./studiobrain-cockpit.mjs";

function makeTempRepo() {
  const root = mkdtempSync(join(tmpdir(), "studiobrain-cockpit-"));
  mkdirSync(join(root, "output", "ops-cockpit"), { recursive: true });
  mkdirSync(join(root, "output", "stability"), { recursive: true });
  mkdirSync(join(root, "output", "overseer", "discord"), { recursive: true });
  return root;
}

function buildRunner() {
  const calls = [];
  const runner = (command, args = []) => {
    calls.push([command, ...args]);
    if (command === "tmux" && args[0] === "list-panes") {
      if (args.includes("#{pane_id}")) {
        return {
          ok: true,
          rc: 0,
          stdout: "%2",
          stderr: "",
        };
      }
      return {
        ok: true,
        rc: 0,
        stdout: [
          "studiobrain\u001fcontrol\u001f1\u001f1\u001f1\u001f1\u001fnode\u001f/home/wuff/monsoonfire-portal\u001fcontrol\u001f0\u001f%1\u001f1\u001f1710000000\u001f@1",
          "sb-codex\u001fmain\u001f1\u001f1\u001f1\u001f0\u001fcodex\u001f/home/wuff/monsoonfire-portal/creative-workspace\u001fcodex\u001f0\u001f%2\u001f0\u001f1710000001\u001f@2",
        ].join("\n"),
        stderr: "",
      };
    }
    if (command === "systemctl" && args[0] === "show" && args[1] === "studio-brain-discord-relay") {
      return { ok: true, rc: 0, stdout: "ActiveState=inactive\nSubState=dead\nUnitFileState=enabled", stderr: "" };
    }
    if (command === "tmux" && args[0] === "has-session") {
      return { ok: false, rc: 1, stdout: "", stderr: "missing" };
    }
    if (command === "tmux" && (args[0] === "new-session" || args[0] === "send-keys")) {
      return { ok: true, rc: 0, stdout: "", stderr: "" };
    }
    return { ok: false, rc: 1, stdout: "", stderr: `${command} ${args.join(" ")}` };
  };
  runner.calls = calls;
  return runner;
}

test("collectCockpitState derives browser-first room and blocker state", () => {
  const repoRoot = makeTempRepo();
  writeFileSync(join(repoRoot, "output", "stability", "heartbeat-summary.json"), JSON.stringify({ status: "pass" }));
  writeFileSync(join(repoRoot, "output", "ops-cockpit", "state.json"), JSON.stringify({ enabled: true }));
  writeFileSync(
    join(repoRoot, "output", "ops-cockpit", "latest-status.json"),
    JSON.stringify({ heartbeatStatus: "pass", postureStatus: "warn", status: "warn" }),
  );
  writeFileSync(
    join(repoRoot, "output", "overseer", "latest.json"),
    JSON.stringify({
      runId: "ovr-123",
      overallStatus: "warning",
      signalGaps: [{ id: "gap-1", dedupeId: "dedupe-1", severity: "warning", title: "Auth mint is flaky", summary: "Repair the mint path." }],
      coordinationActions: [{ id: "act-1", dedupeId: "coord-1", title: "Repair auth mint", summary: "Refresh the auth path." }],
      delivery: { cli: { summary: "Overseer warning: 1 gap, 1 action." }, discord: { summary: "Discord draft" } },
    }),
  );

  const state = collectCockpitState({
    repoRoot,
    runner: buildRunner(),
    rootProcess: true,
    hostUser: "wuff",
  });

  assert.equal(state.counts.escalated, 1);
  assert.equal(state.rooms.length, 1);
  assert.equal(state.rooms[0].sessionNames[0], "sb-codex");
  assert.equal(state.rooms[0].tool, "Codex");
  assert.ok(state.pinnedItems.some((item) => item.title === "Discord Relay is down"));
  assert.ok(state.overview.goodNextMoves.some((action) => action.title === "Repair auth mint"));
});

test("renderRecoveryPanel points operators back to the browser-first control tower", () => {
  const state = {
    theme: { name: "desert-night", label: "Desert Night", colorMode: "dark", motionLevel: "calm", highContrast: false, refreshMode: "diff-only" },
    counts: { needsAttention: 2, working: 3, waiting: 1, blocked: 1, escalated: 1 },
    rooms: [
      {
        id: "creative-workspace",
        name: "creative-workspace",
        project: "creative-workspace",
        cwd: "/home/wuff/monsoonfire-portal/creative-workspace",
        tool: "codex",
        status: "waiting",
        objective: "Waiting on input",
        summary: "1 session in creative-workspace.",
        lastActivityAt: new Date().toISOString(),
        ageMinutes: 0,
        isEscalated: false,
        nextActions: [],
        sessionNames: ["sb-codex"],
      },
    ],
    pinnedItems: [{ title: "Discord Relay is down", detail: "Discord Relay is inactive." }],
    actions: [{ id: "next-1", title: "Repair auth mint", why: "Refresh the auth path.", actionLabel: "Inspect room", target: { type: "ops" } }],
    alerts: [{ title: "Auth mint is flaky", level: "warning", summary: "Repair the mint path." }],
    services: [{ id: "studio-brain-discord-relay", label: "Discord Relay", health: "error", impact: "Operator notifications and Discord delivery", summary: "Discord Relay is inactive.", recentChanges: "Discord Relay is inactive.", actions: [] }],
    events: [],
    overview: {
      needsAttention: [],
      activeRooms: [],
      goodNextMoves: [{ id: "next-1", title: "Repair auth mint", why: "Refresh the auth path.", actionLabel: "Inspect room", target: { type: "ops" } }],
      recentEvents: [],
    },
    ops: { summary: "Overseer warning: 1 gap, 1 action.", ackEntries: [] },
    sources: { operatorStatePath: "", heartbeatPath: "", overseerPath: "", ackLogPath: "" },
  };
  const rendered = renderRecoveryPanel(state, { url: "https://portal.monsoonfire.com/staff/cockpit/control-tower" });

  assert.match(rendered, /Studio Brain Control Tower v2/);
  assert.match(rendered, /Browser-first operator bridge/);
  assert.match(rendered, /Primary route: https:\/\/portal\.monsoonfire\.com\/staff\/cockpit\/control-tower/);
  assert.match(rendered, /Discord Relay is down/);
  assert.match(rendered, /Repair auth mint/);
  assert.match(rendered, /Fast attach: tmux attach -t sb-codex/);
});

test("runServiceAction rejects services outside the allowlist", () => {
  const result = runServiceAction(
    { service: "nginx", action: "restart" },
    { runner: buildRunner(), hostUser: "wuff", rootProcess: true },
  );
  assert.equal(result.ok, false);
  assert.match(result.message, /not allowlisted/);
});

test("spawnSession and sendToSession use tmux-safe commands", () => {
  const repoRoot = makeTempRepo();
  const runner = buildRunner();
  const spawn = spawnSession(
    { name: "sb-codex", cwd: repoRoot, command: "bash", tool: "codex", group: "creative" },
    { repoRoot, runner, hostUser: "wuff", rootProcess: true },
  );
  const send = sendToSession(
    { session: "sb-codex", text: "status?", enter: true },
    { runner, hostUser: "wuff", rootProcess: true },
  );

  assert.equal(spawn.ok, true);
  assert.ok(existsSync(join(repoRoot, "output", "ops-cockpit", "agents", "sb-codex.json")));
  assert.equal(send.ok, true);
  assert.equal(send.sessionName, "sb-codex");
  assert.deepEqual(runner.calls.slice(-2), [
    ["tmux", "send-keys", "-t", "%2", "-l", "status?"],
    ["tmux", "send-keys", "-t", "%2", "Enter"],
  ]);
});

test("appendOverseerAck writes an ack line for the latest run", () => {
  const repoRoot = makeTempRepo();
  writeFileSync(join(repoRoot, "output", "overseer", "latest.json"), JSON.stringify({ runId: "ovr-321", overallStatus: "warning" }));
  const result = appendOverseerAck({ note: "reviewed and queued" }, { repoRoot, actor: "wuff" });
  const ackPath = join(repoRoot, "output", "overseer", "discord", "acks.jsonl");

  assert.equal(result.ok, true);
  assert.ok(existsSync(ackPath));
  assert.match(readFileSync(ackPath, "utf8"), /reviewed and queued/);
  assert.match(readFileSync(ackPath, "utf8"), /ovr-321/);
});
