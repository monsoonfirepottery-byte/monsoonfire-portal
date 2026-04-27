import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { runCodexAppDoctor } from "./codex-app-doctor.mjs";

test("runCodexAppDoctor reports app, cli, browser, and MCP readiness", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-app-doctor-"));
  const home = mkdtempSync(join(tmpdir(), "codex-app-home-"));
  try {
    mkdirSync(join(home, ".codex", "plugins", "cache", "openai-bundled", "browser-use"), { recursive: true });
    mkdirSync(join(home, ".codex"), { recursive: true });
    writeFileSync(
      join(home, ".codex", "config.toml"),
      "[mcp_servers.studio-brain-memory]\ncommand = \"node\"\n",
      "utf8",
    );

    const report = runCodexAppDoctor({
      repoRoot,
      home,
      platform: "win32",
      appPackage: {
        available: true,
        reason: "",
        package: {
          name: "OpenAI.Codex",
          version: "26.422.2339.0",
          packageFullName: "OpenAI.Codex_26.422.2339.0_x64__2p2nqsd0c76g0",
          installLocation: "C:\\Program Files\\WindowsApps\\OpenAI.Codex",
        },
      },
      codexCli: {
        preferred: { path: "C:\\Users\\micah\\AppData\\Local\\OpenAI\\Codex\\bin\\codex.exe", version: "0.125.0" },
        candidates: [],
        versionSet: ["0.125.0"],
        hasVersionAmbiguity: false,
      },
      shellInspection: {
        platform: "win32",
        activeShell: "C:\\Windows\\System32\\cmd.exe",
        powershellLikelyAvailable: true,
        wslAvailable: false,
        wslStatus: null,
      },
    });

    assert.equal(report.status, "warn");
    assert.equal(report.checks.find((check) => check.id === "codex-app-package")?.ok, true);
    assert.equal(report.checks.find((check) => check.id === "codex-cli-version")?.ok, true);
    assert.equal(report.checks.find((check) => check.id === "codex-browser-use")?.ok, true);
    assert.equal(report.checks.find((check) => check.id === "codex-studio-brain-memory-mcp")?.ok, true);
    assert.equal(report.checks.find((check) => check.id === "codex-native-browser-artifacts")?.ok, false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("runCodexAppDoctor fails strict mode on advisory warnings", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-app-doctor-strict-"));
  try {
    const report = runCodexAppDoctor({
      repoRoot,
      home: repoRoot,
      strict: true,
      platform: "linux",
      appPackage: { available: false, reason: "not_windows", package: null },
      codexCli: {
        preferred: { path: "/usr/bin/codex", version: "0.123.0" },
        candidates: [],
        versionSet: ["0.123.0"],
        hasVersionAmbiguity: false,
      },
      shellInspection: {
        platform: "linux",
        activeShell: "/bin/bash",
        powershellLikelyAvailable: false,
        wslAvailable: false,
        wslStatus: null,
      },
    });
    assert.equal(report.status, "fail");
    assert.equal(report.summary.warnings > 0, true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
