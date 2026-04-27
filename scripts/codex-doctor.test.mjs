import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runCodexDoctor } from "./codex-doctor.mjs";

function makeScriptRunner({ openMemoryHealthy, layoutReady, startupPreflightPayload = null, scriptOverrides = {} }) {
  return (relativePath) => {
    const override = scriptOverrides[relativePath];
    if (override) {
      return typeof override === "function" ? override(relativePath) : override;
    }

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

    if (relativePath === "scripts/codex-app-doctor.mjs") {
      return {
        ok: true,
        json: {
          schema: "codex-app-doctor.v1",
          status: "warn",
          summary: { checks: 8, errors: 0, warnings: 1, infos: 7 },
          app: { package: { version: "26.422.2339.0" } },
          codexCli: { preferred: { version: "0.124.0" } },
          capabilities: { browserUse: { available: true } },
          config: { hasStudioBrainMemory: true },
          artifactPath: "output/codex-app-doctor/latest.json",
        },
        stdout: "{\"status\":\"warn\"}",
        stderr: "",
        exitCode: 0,
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
            repoContext: {
              repoProjectLane: "monsoonfire-portal",
              startupPresentationLane: "monsoonfire-portal",
              laneMismatchDetected: false,
              targetedFollowupRecommended: false,
              followupQueries: [],
              repoStatus: {
                branch: "main",
                detached: false,
                dirty: false,
                dirtyCount: 0,
              },
              startupGuidance: {
                agentsPath: "D:\\monsoonfire-portal\\AGENTS.md",
                hasAgentsFile: true,
                startupMemoryFirst: true,
                optionalMemoryAdapter: false,
                repoTruthGuard: true,
                targetedSearchGuidance: true,
                aligned: true,
                mismatchDetected: false,
                state: "aligned",
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

async function runDoctorScenario({
  openMemoryHealthy,
  layoutReady,
  startupPreflightPayload = null,
  toolcallEntries = [],
  scriptOverrides = {},
}) {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-doctor-"));
  const codexConfigPath = join(repoRoot, "config.toml");

  try {
    mkdirSync(join(repoRoot, "output"), { recursive: true });
    mkdirSync(join(repoRoot, ".codex"), { recursive: true });
    writeFileSync(codexConfigPath, "model = \"gpt-5.4\"\n", "utf8");
    writeFileSync(
      join(repoRoot, ".codex", "toolcalls.ndjson"),
      toolcallEntries.map((entry) => JSON.stringify(entry)).join("\n"),
      "utf8"
    );

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
      runNodeScriptImpl: makeScriptRunner({ openMemoryHealthy, layoutReady, startupPreflightPayload, scriptOverrides }),
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

test("runCodexDoctor warns when startup needs repo narrowing, the worktree is dirty on main, or AGENTS guidance is misaligned", async () => {
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
          groundingAuthority: "validated-local",
          publishTrustedGrounding: true,
          startupContextStage: "search-fallback",
          startupCache: {
            cacheHit: false,
            shortCircuitLocal: false,
          },
        },
        repoContext: {
          repoProjectLane: "monsoonfire-portal",
          startupPresentationLane: "studio-brain",
          laneMismatchDetected: true,
          targetedFollowupRecommended: true,
          followupQueries: ["monsoonfire-portal blocker", "monsoonfire-portal deploy"],
          repoStatus: {
            branch: "main",
            detached: false,
            dirty: true,
            dirtyCount: 122,
          },
          startupGuidance: {
            agentsPath: "D:\\monsoonfire-portal\\AGENTS.md",
            hasAgentsFile: true,
            startupMemoryFirst: false,
            optionalMemoryAdapter: true,
            repoTruthGuard: false,
            targetedSearchGuidance: false,
            aligned: false,
            mismatchDetected: true,
            state: "mismatch",
          },
        },
        mcpBridge: { ok: true },
      },
    },
  });

  const repoTargetingCheck = report.checks.find((check) => check.id === "codex-startup-repo-targeting");
  const repoWorktreeCheck = report.checks.find((check) => check.id === "codex-repo-worktree");
  const guidanceCheck = report.checks.find((check) => check.id === "codex-startup-guidance-alignment");

  assert.equal(repoTargetingCheck?.severity, "warning");
  assert.equal(repoTargetingCheck?.ok, false);
  assert.match(repoTargetingCheck?.message || "", /does not match repo lane|needs repo-targeted narrowing/i);

  assert.equal(repoWorktreeCheck?.severity, "warning");
  assert.equal(repoWorktreeCheck?.ok, false);
  assert.match(repoWorktreeCheck?.message || "", /dirty on main/i);

  assert.equal(guidanceCheck?.severity, "warning");
  assert.equal(guidanceCheck?.ok, false);
  assert.match(guidanceCheck?.message || "", /optional without an explicit startup-first repo clause|incomplete/i);
  assert.equal(report.startupContract?.repoContext?.repoProjectLane, "monsoonfire-portal");
});

test("runCodexDoctor treats dirty codex branches as advisory worktree state", async () => {
  const report = await runDoctorScenario({
    openMemoryHealthy: true,
    layoutReady: true,
    startupPreflightPayload: {
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
        repoContext: {
          repoProjectLane: "monsoonfire-portal",
          startupPresentationLane: "monsoonfire-portal",
          laneMismatchDetected: false,
          targetedFollowupRecommended: false,
          followupQueries: [],
          repoStatus: {
            branch: "codex/audits",
            detached: false,
            dirty: true,
            dirtyCount: 122,
          },
          startupGuidance: {
            agentsPath: "D:\\monsoonfire-portal\\AGENTS.md",
            hasAgentsFile: true,
            startupMemoryFirst: true,
            optionalMemoryAdapter: false,
            repoTruthGuard: true,
            targetedSearchGuidance: true,
            aligned: true,
            mismatchDetected: false,
            state: "aligned",
          },
        },
        mcpBridge: { ok: true },
      },
    },
  });
  const repoWorktreeCheck = report.checks.find((check) => check.id === "codex-repo-worktree");

  assert.equal(repoWorktreeCheck?.severity, "info");
  assert.equal(repoWorktreeCheck?.ok, true);
  assert.match(repoWorktreeCheck?.message || "", /advisory only for an active Codex branch/i);
});

test("runCodexDoctor treats duplicate startup observations as advisory when live coverage is already trustworthy", async () => {
  const now = Date.now();
  const toolcallEntries = Array.from({ length: 6 }, (_, index) => {
    const tsIso = new Date(now - index * 1000).toISOString();
    return [
      {
        tsIso,
        tool: "codex-shell",
        action: "startup-bootstrap",
        context: {
          startup: {
            observationClass: "live",
            observationKey: `obs-${index + 1}`,
          },
        },
      },
      {
        tsIso,
        tool: "codex-shell",
        action: "startup-bootstrap",
        context: {
          startup: {
            observationClass: "live",
            observationKey: `obs-${index + 1}`,
          },
        },
      },
    ];
  }).flat();

  const report = await runDoctorScenario({
    openMemoryHealthy: true,
    layoutReady: true,
    toolcallEntries,
  });
  const duplicateCheck = report.checks.find((check) => check.id === "codex-startup-duplicate-observations");

  assert.equal(duplicateCheck?.severity, "info");
  assert.equal(duplicateCheck?.ok, true);
  assert.match(duplicateCheck?.message || "", /coverage remains trustworthy/i);
});

test("runCodexDoctor does not warn on synthetic-only startup observation duplicates", async () => {
  const now = Date.now();
  const toolcallEntries = [
    {
      tsIso: new Date(now).toISOString(),
      tool: "codex-desktop",
      action: "startup-bootstrap",
      context: {
        startup: {
          observationClass: "live",
          observationKey: "live-obs-1",
        },
      },
    },
    {
      tsIso: new Date(now - 1000).toISOString(),
      tool: "codex-startup-preflight",
      action: "startup-bootstrap",
      context: {
        startup: {
          observationClass: "synthetic",
          observationKey: "synthetic-obs-1",
        },
      },
    },
    {
      tsIso: new Date(now - 2000).toISOString(),
      tool: "codex-startup-preflight",
      action: "startup-bootstrap",
      context: {
        startup: {
          observationClass: "synthetic",
          observationKey: "synthetic-obs-1",
        },
      },
    },
  ];

  const report = await runDoctorScenario({
    openMemoryHealthy: true,
    layoutReady: true,
    toolcallEntries,
  });
  const duplicateCheck = report.checks.find((check) => check.id === "codex-startup-duplicate-observations");

  assert.equal(duplicateCheck?.severity, "info");
  assert.equal(duplicateCheck?.ok, true);
  assert.equal(duplicateCheck?.details?.liveDuplicateObservationCount, 0);
  assert.equal(duplicateCheck?.details?.syntheticDuplicateObservationCount, 1);
  assert.match(duplicateCheck?.message || "", /duplicate synthetic observation row\(s\).*live launcher coverage is clean/i);
});

test("runCodexDoctor surfaces timed out child checks with timeout metadata", async () => {
  const report = await runDoctorScenario({
    openMemoryHealthy: true,
    layoutReady: true,
    scriptOverrides: {
      "scripts/open-memory.mjs": {
        ok: false,
        json: null,
        stdout: "",
        stderr: "Timed out after 15000ms while running scripts/open-memory.mjs.",
        exitCode: null,
        command: "node scripts/open-memory.mjs stats",
        durationMs: 15012,
        timeoutMs: 15000,
        timedOut: true,
        signal: "SIGTERM",
        error: "spawnSync node ETIMEDOUT",
      },
    },
  });
  const openMemoryCheck = report.checks.find((check) => check.id === "codex-open-memory");

  assert.equal(openMemoryCheck?.severity, "warning");
  assert.equal(openMemoryCheck?.ok, false);
  assert.match(openMemoryCheck?.message || "", /timed out/i);
  assert.equal(openMemoryCheck?.details?.timedOut, true);
  assert.equal(openMemoryCheck?.details?.timeoutMs, 15000);
  assert.equal(openMemoryCheck?.details?.durationMs, 15012);
});
