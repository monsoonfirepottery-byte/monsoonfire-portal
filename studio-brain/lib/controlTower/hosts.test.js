"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtempSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

const { listControlTowerHostHeartbeats, writeControlTowerHostHeartbeat } = require("./hosts");

test("host heartbeats preserve Codex app presence metadata", () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "control-tower-hosts-"));
    writeControlTowerHostHeartbeat(repoRoot, {
        schema: "control-tower-host-heartbeat.v1",
        hostId: "desktop-1",
        label: "Desktop",
        environment: "local",
        role: "operator-laptop",
        health: "healthy",
        lastSeenAt: "2026-04-24T00:00:00.000Z",
        currentRunId: "run-1",
        agentCount: 1,
        version: "codex-cli 0.124.0",
        metadata: {
            codexAppVersion: "26.422.2339.0",
            activeCommand: "npm run codex:doctor",
            verificationLane: "background",
            ignoredUndefined: undefined,
        },
        metrics: {
            memoryPct: 42,
        },
    });

    const hosts = listControlTowerHostHeartbeats(repoRoot, Date.parse("2026-04-24T00:01:00.000Z"));

    assert.equal(hosts.length, 1);
    assert.equal(hosts[0].metadata.codexAppVersion, "26.422.2339.0");
    assert.equal(hosts[0].metadata.ignoredUndefined, undefined);
    assert.match(hosts[0].summary, /npm run codex:doctor/);
});
