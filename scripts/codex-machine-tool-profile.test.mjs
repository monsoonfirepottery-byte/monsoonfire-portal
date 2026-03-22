import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import {
  attachMachineToolProfileContext,
  machineToolProfileRefreshDecision,
  probeMachineToolProfile,
  syncMachineToolProfile,
} from "./lib/codex-machine-tool-profile.mjs";
import { readJson } from "./lib/pst-memory-utils.mjs";

function writeStubExecutable(path) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "", "utf8");
}

function buildWindowsToolEnv(tempDir) {
  const powershellDir = join(tempDir, "Program Files", "PowerShell", "7");
  const gitCmdDir = join(tempDir, "Program Files", "Git", "cmd");
  const gitBinDir = join(tempDir, "Program Files", "Git", "bin");
  const npmDir = join(tempDir, "AppData", "Roaming", "npm");
  const msysDir = join(tempDir, "msys64", "usr", "bin");
  const pythonDir = join(tempDir, "AppData", "Local", "Programs", "Python", "Python312");
  const githubCliDir = join(tempDir, "Program Files", "GitHub CLI");
  const nodeDir = join(tempDir, "nvm4w", "nodejs");

  writeStubExecutable(join(powershellDir, "pwsh.exe"));
  writeStubExecutable(join(gitCmdDir, "git.exe"));
  writeStubExecutable(join(gitBinDir, "bash.exe"));
  writeStubExecutable(join(npmDir, "rg.exe"));
  writeStubExecutable(join(npmDir, "npx.cmd"));
  writeStubExecutable(join(msysDir, "rsync.exe"));
  writeStubExecutable(join(pythonDir, "python.exe"));
  writeStubExecutable(join(githubCliDir, "gh.exe"));
  writeStubExecutable(join(nodeDir, "node.exe"));

  return {
    PATH: [
      powershellDir,
      gitCmdDir,
      gitBinDir,
      npmDir,
      msysDir,
      pythonDir,
      githubCliDir,
      nodeDir,
    ].join(";"),
    PATHEXT: ".COM;.EXE;.BAT;.CMD",
    PSModulePath: join(tempDir, "Documents", "PowerShell", "Modules"),
  };
}

test("probeMachineToolProfile resolves Windows tool paths and missing commands", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-tool-profile-"));
  try {
    const env = buildWindowsToolEnv(tempDir);
    const profile = probeMachineToolProfile({
      env,
      platform: "win32",
      hostname: "micah-box",
      shell: "pwsh.exe",
      now: "2026-03-21T18:30:00.000Z",
    });

    const rg = profile.tools.find((tool) => tool.name === "rg");
    const rsync = profile.tools.find((tool) => tool.name === "rsync");
    const cargo = profile.tools.find((tool) => tool.name === "cargo");

    assert.equal(profile.hostname, "micah-box");
    assert.equal(profile.shell, "pwsh.exe");
    assert.equal(rg?.status, "present");
    assert.equal(rg?.sourceHint, "npm shim");
    assert.equal(String(rg?.path || "").endsWith("AppData\\Roaming\\npm\\rg.exe"), true);
    assert.equal(rsync?.status, "present");
    assert.equal(rsync?.sourceHint, "MSYS2");
    assert.equal(cargo?.status, "missing");
    assert.equal(profile.summary.includes("Missing cargo, uv."), true);
    assert.equal(profile.content.includes("- rg: present"), true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("machineToolProfileRefreshDecision refreshes on changed fingerprints and stale captures only", () => {
  const nextProfile = {
    toolFingerprint: "fingerprint-a",
  };
  const previousFresh = {
    toolFingerprint: "fingerprint-a",
    lastMemoryWriteAt: "2026-03-20T18:30:00.000Z",
  };
  const previousStale = {
    toolFingerprint: "fingerprint-a",
    lastMemoryWriteAt: "2026-03-01T18:30:00.000Z",
  };
  const previousChanged = {
    toolFingerprint: "fingerprint-b",
    lastMemoryWriteAt: "2026-03-20T18:30:00.000Z",
  };

  assert.deepEqual(
    machineToolProfileRefreshDecision(previousFresh, nextProfile, {
      nowMs: Date.parse("2026-03-21T18:30:00.000Z"),
    }),
    { refresh: false, reason: "fresh" }
  );
  assert.deepEqual(
    machineToolProfileRefreshDecision(previousStale, nextProfile, {
      nowMs: Date.parse("2026-03-21T18:30:00.000Z"),
    }),
    { refresh: true, reason: "stale" }
  );
  assert.deepEqual(
    machineToolProfileRefreshDecision(previousChanged, nextProfile, {
      nowMs: Date.parse("2026-03-21T18:30:00.000Z"),
    }),
    { refresh: true, reason: "fingerprint-changed" }
  );
});

test("syncMachineToolProfile writes caches and skips remote writes when the profile is still fresh", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "codex-tool-profile-sync-"));
  const sharedCachePath = join(tempDir, "tool-profile-cache.json");
  const threadSnapshotPath = join(tempDir, "runtime", "tool-profile.json");
  const calls = [];

  try {
    const env = buildWindowsToolEnv(tempDir);
    const first = await syncMachineToolProfile({
      env,
      platform: "win32",
      hostname: "micah-box",
      shell: "pwsh.exe",
      now: "2026-03-21T18:30:00.000Z",
      sharedCachePath,
      threadSnapshotPath,
      awaitRemoteWrite: true,
      requestJson: async (request) => {
        calls.push(request);
        return {
          ok: true,
          memory: { id: "mem_tool_profile_1" },
        };
      },
    });

    assert.equal(first.refresh.refresh, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/api/memory/capture");
    assert.equal(calls[0].body.metadata.subjectKey, "codex-machine-tool-profile");
    assert.equal(calls[0].body.metadata.tools.length >= 9, true);

    const cachedAfterFirst = readJson(sharedCachePath, {});
    const threadSnapshot = readJson(threadSnapshotPath, {});
    assert.equal(cachedAfterFirst.memoryId, "mem_tool_profile_1");
    assert.equal(threadSnapshot.memoryId, "mem_tool_profile_1");
    assert.equal(String(cachedAfterFirst.lastMemoryWriteAt).startsWith("2026-03-21T18:30:00.000Z"), true);

    const second = await syncMachineToolProfile({
      env,
      platform: "win32",
      hostname: "micah-box",
      shell: "pwsh.exe",
      now: "2026-03-22T18:30:00.000Z",
      sharedCachePath,
      threadSnapshotPath,
      awaitRemoteWrite: true,
      requestJson: async (request) => {
        calls.push(request);
        return {
          ok: true,
          memory: { id: "mem_tool_profile_2" },
        };
      },
    });

    assert.equal(second.refresh.refresh, false);
    assert.equal(calls.length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("attachMachineToolProfileContext appends a compact tooling note without duplicating the item", () => {
  const profile = {
    hostname: "micah-box",
    os: "win32",
    shell: "pwsh.exe",
    capturedAt: "2026-03-21T18:30:00.000Z",
    pathFingerprint: "path-fingerprint",
    toolFingerprint: "tool-fingerprint",
    tags: ["codex", "tool-profile"],
    tools: [
      { name: "rg", status: "present", path: "C:\\Tools\\rg.exe", purpose: "Fast text and file search", sourceHint: "npm shim" },
      { name: "cargo", status: "missing", path: "", purpose: "Rust package manager and build tool", sourceHint: "unavailable" },
    ],
  };

  const first = attachMachineToolProfileContext(
    {
      summary: "Existing continuity summary.",
      items: [{ id: "row-1", source: "codex-handoff", content: "Keep working.", metadata: {} }],
    },
    profile,
    { include: true }
  );
  const second = attachMachineToolProfileContext(first, profile, { include: true });

  assert.equal(Array.isArray(first.items), true);
  assert.equal(first.items.length, 2);
  assert.equal(first.summary.includes("Tooling baseline:"), true);
  assert.equal(second.items.length, 2);
});
