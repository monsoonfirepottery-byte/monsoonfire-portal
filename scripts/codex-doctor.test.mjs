import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCodexDoctor } from "./codex-doctor.mjs";

function makeScriptRunner({ openMemoryHealthy, layoutReady, startupPreflightPayload = null }) {
  return (relativePath) => {
    if (relativePath === "scripts/codex-docs-drift-check.mjs") {
      return {
        ok: true,
        json: {
          status: "pass",
          summary: { errors: 0, warnings: 0 },
          artifactPath: "output/codex-docs-drift/latest.json",
        },
        command: `node ${relativePath} --json`,
      };
    }

    if (relativePath === "scripts/audit-codex-mcp.mjs") {
      return {
        ok: true,
        stdout: "PASS",
        stderr: "",
        exitCode: 0,
        command: `node ${relativePath}`,
      };
    }

    if (relativePath === "scripts/open-memory.mjs") {
      if (openMemoryHealthy) {
        return {
          ok: true,
          json: { stats: { total: 3 } },
          stdout: '{"stats":{"total":3}}',
          stderr: "",
          exitCode: 0,
          command: `node ${relativePath} stats`,
        };
      }

      return {
        ok: false,
        json: null,
        stdout: "",
        stderr: "auth failed",
        exitCode: 1,
        command: `node ${relativePath} stats`,
      };
    }

    if (relativePath === "scripts/codex-startup-preflight.mjs") {
      return {
        ok: true,
        json: startupPreflightPayload || {
          status: "pass",
          checks: {
            tokenFreshness: { state: "fresh" },
            startupContext: {
              reasonCode: "ok",
              latency: { state: "healthy" },
              continuityState: "ready",
              groundingAuthority: "validated-local",
              publishTrustedGrounding: true,
              startupContextStage: "local-validated-short-circuit",
              startupCache: {
                cacheHit: false,
                shortCircuitLocal: true,
              },
            },
            mcpBridge: { ok: true },
          },
        },
        command: `node ${relativePath} --json --run-id codex-doctor`,
      };
    }

    if (relativePath === "scripts/codex-memory-pipeline.mjs") {
      return {
        ok: true,
        json: {
          memory: {
            memoryRoot: "D:\\monsoonfire-portal\\memory",
            layoutReady,
            proposedCount: 0,
            acceptedCount: 0,
          },
        },
        command: `node ${relativePath} status --json`,
      };
    }

    if (relativePath === "scripts/check-ephemeral-artifact-tracking.mjs") {
      return {
        ok: true,
        json: { status: "pass", artifactPath: "output/qa/ephemeral.json" },
        command: `node ${relativePath} --json`,
      };
    }

    if (relativePath === "scripts/audit-cross-platform-wrappers.mjs") {
      return {
        ok: true,
        json: { status: "pass", targetFiles: [] },
        command: `node ${relativePath}`,
      };
    }

    throw new Error(`Unexpected script: ${relativePath}`);
  };
}

async function runDoctorScenario({ openMemoryHealthy, layoutReady, startupPreflightPayload = null }) {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-doctor-"));
  const codexConfigPath = join(repoRoot, "config.toml");

  try {
    mkdirSync(join(repoRoot, "output"), { recursive: true });
    writeFileSync(codexConfigPath, "model = \"gpt-5.4\"\n", "utf8");

    const env = {};
    const report = await runCodexDoctor({
      repoRoot,
      artifact: "output/codex-doctor/latest.json",
      env,
      codexConfigPath,
      codexCli: {
        preferred: {
          path: "C:\\nvm4w\\nodejs\\codex.cmd",
          version: "0.105.0",
        },
        candidates: [
          {
            path: "C:\\nvm4w\\nodejs\\codex.cmd",
            version: "0.105.0",
            sources: ["active-path"],
            isLocal: false,
            rawVersionOutput: "codex-cli 0.105.0",
          },
        ],
        versionSet: ["0.105.0"],
        hasVersionAmbiguity: false,
      },
      packageMeta: {
        dependencyRange: null,
        lockVersion: null,
        packageJsonPath: join(repoRoot, "package.json"),
        packageLockPath: join(repoRoot, "package-lock.json"),
      },
      runNodeScriptImpl: makeScriptRunner({ openMemoryHealthy, layoutReady, startupPreflightPayload }),
      loadCodexAutomationEnvFn: () => [],
      hydrateStudioBrainAuthFromPortalFn: async ({ env: authEnv }) => {
        if (openMemoryHealthy) {
          authEnv.STUDIO_BRAIN_AUTH_TOKEN = "Bearer token";
          return { ok: true, hydrated: true, reason: "", source: "test" };
        }
        return { ok: false, hydrated: false, reason: "missing_token", source: "test" };
      },
    });

    return report;
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
}

test("runCodexDoctor reports missing local fallback as info when remote Open Memory is healthy", async () => {
  const report = await runDoctorScenario({ openMemoryHealthy: true, layoutReady: false });
  const memoryCheck = report.checks.find((check) => check.id === "codex-memory-fallback-layout");
  assert.equal(memoryCheck?.severity, "info");
  assert.equal(memoryCheck?.ok, true);
  assert.match(memoryCheck?.message || "", /not initialized/i);
});

test("runCodexDoctor reports missing local fallback as warning when remote Open Memory is unavailable", async () => {
  const report = await runDoctorScenario({ openMemoryHealthy: false, layoutReady: false });
  const memoryCheck = report.checks.find((check) => check.id === "codex-memory-fallback-layout");
  assert.equal(memoryCheck?.severity, "warning");
  assert.equal(memoryCheck?.ok, false);
});

test("runCodexDoctor reports initialized local fallback cleanly when remote Open Memory is healthy", async () => {
  const report = await runDoctorScenario({ openMemoryHealthy: true, layoutReady: true });
  const memoryCheck = report.checks.find((check) => check.id === "codex-memory-fallback-layout");
  assert.equal(memoryCheck?.severity, "info");
  assert.equal(memoryCheck?.ok, true);
  assert.match(memoryCheck?.message || "", /initialized/i);
});

test("runCodexDoctor surfaces the validated-local fast path and trusted grounding alignment", async () => {
  const report = await runDoctorScenario({ openMemoryHealthy: true, layoutReady: true });
  const fastPathCheck = report.checks.find((check) => check.id === "codex-startup-fast-path");
  const trustCheck = report.checks.find((check) => check.id === "codex-startup-grounding-trust");

  assert.equal(fastPathCheck?.severity, "info");
  assert.equal(fastPathCheck?.ok, true);
  assert.match(fastPathCheck?.message || "", /validated-local fast path/i);
  assert.equal(trustCheck?.severity, "info");
  assert.equal(trustCheck?.ok, true);
  assert.match(trustCheck?.message || "", /aligned/i);
  assert.equal(report.startupContract?.startupContextStage, "local-validated-short-circuit");
  assert.equal(report.startupContract?.groundingAuthority, "validated-local");
});

test("runCodexDoctor warns when startup publishes untrusted or advisory-only grounding", async () => {
  const report = await runDoctorScenario({
    openMemoryHealthy: true,
    layoutReady: true,
    startupPreflightPayload: {
      status: "degraded",
      checks: {
        tokenFreshness: { state: "fresh" },
        startupContext: {
          reasonCode: "ok",
          latency: { state: "healthy" },
          continuityState: "ready",
          groundingAuthority: "cross-thread-fallback",
          publishTrustedGrounding: false,
          dominantGoal: "Resume an unrelated startup thread.",
          topBlocker: "Dream consolidation artifact is missing.",
          startupContextStage: "search-fallback",
          startupCache: {
            cacheHit: false,
            shortCircuitLocal: false,
          },
          trustMismatchDetected: true,
          advisory: {
            dominantGoal: "Resume an unrelated startup thread.",
            topBlocker: "Dream consolidation artifact is missing.",
          },
        },
        mcpBridge: { ok: true },
      },
    },
  });
  const fastPathCheck = report.checks.find((check) => check.id === "codex-startup-fast-path");
  const trustCheck = report.checks.find((check) => check.id === "codex-startup-grounding-trust");

  assert.equal(fastPathCheck?.severity, "warning");
  assert.equal(fastPathCheck?.ok, false);
  assert.match(fastPathCheck?.message || "", /search-fallback/i);
  assert.equal(trustCheck?.severity, "warning");
  assert.equal(trustCheck?.ok, false);
  assert.match(trustCheck?.message || "", /untrusted grounding authority|advisory-only/i);
});
