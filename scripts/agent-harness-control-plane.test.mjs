import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAgentSelectableToolRegistry,
  compileToolPrimitiveFamilies,
  auditToolContractLifecycle,
  buildContextPack,
  buildMissionEnvelope,
  createInitialRunSummary,
  mergeToolContractRegistries,
  loadToolContractRegistry,
  validateToolContractRegistry,
} from "./lib/agent-harness-control-plane.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const samplePlan = {
  schema: "intent-plan.v1",
  planDigestSha256: "plan-digest",
  intents: [],
  tasks: [
    {
      taskId: "demo-intent::collect",
      intentId: "demo-intent",
      title: "Collect signals",
      dependsOn: [],
      checks: ["npm run startup:check"],
      writeScope: "none",
      actionType: "analyze",
      riskTier: "medium",
      priorityClass: "P2",
      authorityTier: "T2",
    },
  ],
};

const sampleIntentSources = new Map([
  [
    "demo-intent",
    {
      intentId: "demo-intent",
      title: "Demo Intent",
      objective: "Keep the mission locked to a bounded objective.",
      nonGoals: ["Do not wander into unrelated cleanup."],
      constraints: {
        riskTier: "medium",
        maxChangedFiles: 12,
        maxWriteActions: 2,
        writePolicy: "artifact-only",
      },
      autonomy: {
        mode: "bounded",
        allowedTools: ["functions.exec_command"],
      },
      authority: {
        tier: "T2",
        approvalRequiredFor: ["force-push"],
      },
      requiredEvidenceTypes: ["tool_output", "repo_state"],
      doneCriteria: {
        requiredChecks: ["npm run startup:check"],
        requiredArtifacts: ["output/demo.json"],
        requiredDocs: ["docs/demo.md"],
      },
      capabilityToken: "capref_demo_intent",
      priorityClass: "P2",
    },
  ],
]);

test("tool contract registry validator enforces required fields", () => {
  const validation = validateToolContractRegistry({
    schema: "agent-tool-contract-registry.v1",
    tools: [
      {
        toolId: "startup.preflight",
        kind: "repo-script",
        command: "node preflight.mjs",
        purpose: "Check startup.",
        verificationCommand: "node preflight.mjs",
        safeFailBehavior: "Block the mission.",
        rollbackBehavior: "None.",
        lifecycle: {
          owner: "agent-platform",
          class: "adapter",
          reviewEveryDays: 14,
          lastReviewedAt: "2026-04-16T00:00:00.000Z",
          nativeAlternative: "studio-brain-memory:start-context",
          retireWhen: "Native startup and continuity primitives cover the same contract surface.",
        },
      },
    ],
  });

  assert.equal(validation.status, "pass");
  assert.equal(validation.findings.length, 0);
});

test("mission envelope aggregates verifier and tool budget policy", () => {
  const envelope = buildMissionEnvelope(
    process.cwd(),
    { intentIds: ["demo-intent"], runId: "run-demo" },
    { plan: samplePlan, intentSources: sampleIntentSources },
  );

  assert.equal(envelope.runId, "run-demo");
  assert.equal(envelope.riskLane, "background");
  assert.equal(envelope.verifierSpec.requiredChecks.length, 1);
  assert.equal(envelope.toolBudget.maxChangedFiles, 12);
  assert.equal(
    envelope.mutationPolicy.preferredPrimitive,
    process.platform === "win32" ? "workspace.mutation.file-plan" : "functions.apply_patch",
  );
  assert.equal(envelope.nonGoals.includes("Do not wander into unrelated cleanup."), true);
});

test("mission envelope prefers the file-plan primitive on Windows", () => {
  const envelope = buildMissionEnvelope(
    process.cwd(),
    { intentIds: ["demo-intent"], runId: "run-demo", platform: "win32" },
    { plan: samplePlan, intentSources: sampleIntentSources },
  );

  assert.equal(envelope.mutationPolicy.preferredPrimitive, "workspace.mutation.file-plan");
  assert.equal(envelope.mutationPolicy.maxFilesPerBatch, 4);
});

test("context pack surfaces startup trust blockers and memory guidance", () => {
  const contextPack = buildContextPack(
    process.cwd(),
    { runId: "run-demo" },
    {
      startupPayload: {
        checks: {
          startupContext: {
            continuityState: "ready",
            reasonCode: "ok",
            contextSummary: "Loaded goal and blocker.",
            recoveryStep: "",
          },
        },
      },
      startupScorecard: {
        latest: { sample: { status: "pass" } },
        rubric: { grade: "B" },
        launcherCoverage: {
          trustworthy: false,
          liveStartupSamples: 2,
          requiredLiveStartupSamples: 5,
        },
      },
      memoryBrief: {
        summary: "Memory summary",
        goal: "Goal summary",
        blockers: ["Need more live samples"],
        recentDecisions: ["Keep memory-first retrieval"],
        recommendedNextActions: ["Collect more live startup samples"],
        layers: {
          coreBlocks: ["Goal summary"],
          workingMemory: ["Need more live samples"],
          episodicMemory: ["Recent decision"],
          canonicalMemory: ["Corpus authority"],
        },
      },
      repoSnapshot: {
        branch: "codex/test",
        dirtyCount: 2,
        changedFiles: [" M scripts/file.mjs"],
      },
      corpusSignals: {
        available: true,
        root: "output/open-memory/corpus",
        authority: "canonical-corpus-first",
      },
    },
  );

  assert.equal(contextPack.telemetry.startupTrustworthy, false);
  assert.equal(contextPack.telemetry.startupBlockers[0], "startup coverage is 2/5 live samples and is not yet trustworthy");
  assert.equal(contextPack.memoriesInfluencingRun.includes("Goal summary"), true);
});

test("initial run summary projects operator board data", () => {
  const missionEnvelope = buildMissionEnvelope(
    process.cwd(),
    { intentIds: ["demo-intent"], runId: "run-demo" },
    { plan: samplePlan, intentSources: sampleIntentSources },
  );
  const contextPack = {
    groundingSources: ["codex-startup-preflight"],
    telemetry: {
      startupBlockers: ["startup coverage is 1/5 live samples and is not yet trustworthy"],
    },
    memory: {
      blockers: ["Need more live samples"],
    },
    memoriesInfluencingRun: ["Goal summary"],
  };

  const summary = createInitialRunSummary(missionEnvelope, contextPack);
  assert.equal(summary.status, "blocked");
  assert.equal(summary.boardRow.state, "blocked");
  assert.equal(summary.boardRow.blocker, "startup coverage is 1/5 live samples and is not yet trustworthy");
});

test("tool lifecycle audit flags repo-script wrappers missing native alternatives or review freshness", () => {
  const audit = auditToolContractLifecycle({
    schema: "agent-tool-contract-registry.v1",
    tools: [
      {
        toolId: "runtime.wrapper",
        kind: "repo-script",
        command: "node runtime-wrapper.mjs",
        purpose: "Bridge a temporary runtime gap.",
        verificationCommand: "node runtime-wrapper.mjs --check",
        safeFailBehavior: "Stop.",
        rollbackBehavior: "None.",
        lifecycle: {
          owner: "agent-platform",
          class: "wrapper",
          reviewEveryDays: 7,
          lastReviewedAt: "2026-03-01T00:00:00.000Z",
          retireWhen: "Retire when the native runtime surface can launch directly.",
        },
      },
    ],
  });

  assert.equal(audit.status, "warn");
  assert.equal(audit.findings.some((finding) => /nativeAlternative/.test(finding.message)), true);
});

test("tool contract registry validator accepts host-native memory hygiene tools without wrapper lifecycle metadata", () => {
  const validation = validateToolContractRegistry({
    schema: "agent-tool-contract-registry.v1",
    tools: [
      {
        toolId: "memory.hygiene.scrub-thread-metadata",
        kind: "mcp",
        command: "studio-brain-memory:scrub-thread-metadata",
        purpose: "Repair stale synthetic thread metadata through the Studio Brain host control plane.",
        verificationCommand: "node ./scripts/open-memory.mjs scrub-thread-metadata --dry-run true --limit 50",
        safeFailBehavior: "Stop after the dry-run wave and require operator review before any live repair pass.",
        rollbackBehavior: "Use memory review and repair receipts to reverse or quarantine suspect metadata writes.",
      },
    ],
  });

  assert.equal(validation.status, "pass");
  assert.equal(validation.findings.length, 0);
});

test("tool contract registry validator requires native spec for runtime primitives", () => {
  const validation = validateToolContractRegistry({
    schema: "agent-tool-contract-registry.v1",
    tools: [
      {
        toolId: "verify.portal.smoke",
        kind: "runtime-primitive",
        command: "node ./scripts/portal-playwright-smoke.mjs --base-url https://portal.monsoonfire.com",
        purpose: "Run portal smoke.",
        verificationCommand: "node ./scripts/portal-playwright-smoke.mjs --base-url https://portal.monsoonfire.com",
        safeFailBehavior: "Stop.",
        rollbackBehavior: "None.",
      },
    ],
  });

  assert.equal(validation.status, "fail");
  assert.equal(validation.findings.some((finding) => /nativeSpec/.test(finding.message)), true);
});

test("agent-selectable tool registry filters out internal control-plane adapters", () => {
  const filtered = buildAgentSelectableToolRegistry({
    schema: "agent-tool-contract-registry.v1",
    tools: [
      {
        toolId: "startup.preflight",
        kind: "repo-script",
        command: "node preflight.mjs",
        purpose: "Control-plane startup.",
        verificationCommand: "node preflight.mjs",
        safeFailBehavior: "Block.",
        rollbackBehavior: "None.",
        selectableByAgent: false,
        lifecycle: {
          owner: "agent-platform",
          class: "adapter",
          reviewEveryDays: 14,
          lastReviewedAt: "2026-04-16T00:00:00.000Z",
          nativeAlternative: "memory.startup-context",
          retireWhen: "Native startup context is used directly.",
        },
      },
      {
        toolId: "memory.context",
        kind: "mcp",
        command: "studio-brain-memory:context",
        purpose: "Memory context.",
        verificationCommand: "node stats.mjs",
        safeFailBehavior: "Fallback.",
        rollbackBehavior: "None.",
      },
    ],
  });

  assert.deepEqual(
    filtered.tools.map((tool) => tool.toolId),
    ["memory.context"],
  );
});

test("tool lifecycle audit ignores native-alternative nagging for internal non-selectable adapters", () => {
  const audit = auditToolContractLifecycle({
    schema: "agent-tool-contract-registry.v1",
    tools: [
      {
        toolId: "startup.preflight",
        kind: "repo-script",
        selectableByAgent: false,
        command: "node preflight.mjs",
        purpose: "Control-plane startup.",
        verificationCommand: "node preflight.mjs",
        safeFailBehavior: "Block.",
        rollbackBehavior: "None.",
        lifecycle: {
          owner: "agent-platform",
          class: "adapter",
          reviewEveryDays: 30,
          lastReviewedAt: "2026-04-16T00:00:00.000Z",
          nativeAlternative: "memory.startup-context",
          retireWhen: "Native startup context is used directly.",
        },
      },
      {
        toolId: "memory.startup-context",
        kind: "mcp",
        command: "studio-brain-memory:startup_context",
        purpose: "Memory startup context.",
        verificationCommand: "node preflight.mjs",
        safeFailBehavior: "Fallback.",
        rollbackBehavior: "None.",
      },
    ],
  });

  assert.equal(audit.status, "pass");
  assert.equal(audit.findings.length, 0);
});

test("tool primitive families compile deploy and playwright verifier contracts", () => {
  const compiled = compileToolPrimitiveFamilies({
    schema: "agent-tool-primitive-family-registry.v1",
    families: [
      {
        familyId: "deploy.family",
        builder: "namecheap-live-deploy",
        defaults: {
          kind: "runtime-primitive",
          sideEffects: "deploy_live_portal",
          dryRunSupport: false,
          safeFailBehavior: "Stop.",
          rollbackBehavior: "Rollback.",
          lifecycle: {
            owner: "deploy-platform",
            class: "adapter",
            reviewEveryDays: 21,
            lastReviewedAt: "2026-04-16T00:00:00.000Z",
            nativeAlternative: "live-deploy-primitive",
            retireWhen: "Native deploy exists.",
          },
        },
        entries: [
          {
            toolId: "deploy.portal",
            purpose: "Deploy portal.",
            remotePath: "portal/",
            portalUrl: "https://portal.monsoonfire.com",
            verify: true,
            verificationCommand: "node verify.mjs",
          },
        ],
      },
      {
        familyId: "verify.family",
        builder: "playwright-smoke-verifier",
        defaults: {
          kind: "runtime-primitive",
          sideEffects: "artifact_only",
          dryRunSupport: true,
          safeFailBehavior: "Stop.",
          rollbackBehavior: "None.",
          lifecycle: {
            owner: "qa-platform",
            class: "adapter",
            reviewEveryDays: 21,
            lastReviewedAt: "2026-04-16T00:00:00.000Z",
            nativeAlternative: "playwright-visual-verification",
            retireWhen: "Native verify exists.",
          },
        },
        entries: [
          {
            toolId: "verify.portal",
            purpose: "Verify portal.",
            script: "./scripts/portal-playwright-smoke.mjs",
            baseUrl: "https://portal.monsoonfire.com",
            outputDir: "output/playwright/portal/prod",
          },
        ],
      },
    ],
  });

  assert.equal(compiled.tools.length, 2);
  assert.equal(compiled.primitiveFamilies.generatedCount, 2);
  assert.equal(compiled.tools[0].kind, "runtime-primitive");
  assert.match(compiled.tools[0].command, /deploy-namecheap-portal\.mjs/);
  assert.match(compiled.tools[1].command, /portal-playwright-smoke\.mjs/);
  assert.equal(compiled.tools[0].generatedFrom.familyId, "deploy.family");
  assert.deepEqual(compiled.tools[0].nativeSpec.argv.slice(0, 2), ["node", "./scripts/deploy-namecheap-portal.mjs"]);
  assert.match(compiled.tools[1].nativeSpec.probeCommand, /--benchmark-probe --json/);
});

test("tool primitive families compile native-browser shadow verifier contracts", () => {
  const compiled = compileToolPrimitiveFamilies({
    schema: "agent-tool-primitive-family-registry.v1",
    families: [
      {
        familyId: "verify.native-browser-shadow",
        builder: "native-browser-shadow-verifier",
        defaults: {
          kind: "runtime-primitive",
          selectableByAgent: false,
          sideEffects: "artifact_only",
          dryRunSupport: true,
          safeFailBehavior: "Keep advisory.",
          rollbackBehavior: "None.",
          script: "./scripts/native-browser-shadow-verifier.mjs",
          lifecycle: {
            owner: "qa-platform",
            class: "adapter",
            reviewEveryDays: 14,
            lastReviewedAt: "2026-04-17T00:00:00.000Z",
            nativeAlternative: "codex-native-browser-verification",
            retireWhen: "Native browser verifier exists.",
          },
        },
        entries: [
          {
            toolId: "verify.portal.native-browser.shadow",
            purpose: "Prepare portal shadow verification.",
            surface: "portal",
            baseUrl: "https://portal.monsoonfire.com",
            outputDir: "output/native-browser/portal/prod",
            canonicalArtifactRoot: "output/playwright/portal/prod",
            shadowOf: "verify.portal.smoke",
          },
        ],
      },
    ],
  });

  assert.equal(compiled.tools.length, 1);
  assert.equal(compiled.tools[0].toolId, "verify.portal.native-browser.shadow");
  assert.equal(compiled.tools[0].selectableByAgent, false);
  assert.match(compiled.tools[0].command, /native-browser-shadow-verifier\.mjs/);
  assert.match(compiled.tools[0].command, /--surface portal/);
  assert.match(compiled.tools[0].nativeSpec.probeCommand, /--benchmark-probe --json/);
  assert.equal(compiled.tools[0].generatedFrom.builder, "native-browser-shadow-verifier");
});

test("tool primitive families compile native-browser shadow exec contracts", () => {
  const compiled = compileToolPrimitiveFamilies({
    schema: "agent-tool-primitive-family-registry.v1",
    families: [
      {
        familyId: "verify.native-browser-shadow-exec",
        builder: "native-browser-shadow-verifier",
        defaults: {
          kind: "runtime-primitive",
          selectableByAgent: false,
          sideEffects: "artifact_only",
          dryRunSupport: true,
          safeFailBehavior: "Keep advisory.",
          rollbackBehavior: "None.",
          script: "./scripts/native-browser-shadow-verifier.mjs",
          execute: true,
          lifecycle: {
            owner: "qa-platform",
            class: "adapter",
            reviewEveryDays: 14,
            lastReviewedAt: "2026-04-18T00:00:00.000Z",
            nativeAlternative: "codex-native-browser-verification",
            retireWhen: "Native browser verifier exists.",
          },
        },
        entries: [
          {
            toolId: "verify.website.native-browser.shadow.exec",
            purpose: "Execute website shadow verification.",
            surface: "website",
            baseUrl: "https://monsoonfire.com",
            outputDir: "output/native-browser/website/prod",
            canonicalArtifactRoot: "output/playwright/prod",
            shadowOf: "verify.website.smoke",
            expectedPortalHost: "portal.monsoonfire.com",
          },
        ],
      },
    ],
  });

  assert.equal(compiled.tools.length, 1);
  assert.equal(compiled.tools[0].toolId, "verify.website.native-browser.shadow.exec");
  assert.match(compiled.tools[0].command, /--execute/);
  assert.match(compiled.tools[0].nativeSpec.probeCommand, /--execute .*--benchmark-probe --json/);
});

test("tool contract registries merge manual and generated tools", () => {
  const merged = mergeToolContractRegistries(
    {
      schema: "agent-tool-contract-registry.v1",
      generatedAt: "2026-04-16T00:00:00.000Z",
      tools: [
        {
          toolId: "memory.context",
          kind: "mcp",
          command: "studio-brain-memory:context",
          purpose: "Memory context.",
          verificationCommand: "node stats.mjs",
          safeFailBehavior: "Fallback.",
          rollbackBehavior: "None.",
        },
      ],
    },
    {
      schema: "agent-tool-contract-registry.v1",
      tools: [
        {
          toolId: "verify.portal",
          kind: "repo-script",
          command: "node portal.mjs",
          purpose: "Portal verification.",
          verificationCommand: "node portal.mjs",
          safeFailBehavior: "Stop.",
          rollbackBehavior: "None.",
          lifecycle: {
            owner: "qa-platform",
            class: "adapter",
            reviewEveryDays: 21,
            lastReviewedAt: "2026-04-16T00:00:00.000Z",
            nativeAlternative: "playwright-visual-verification",
            retireWhen: "Native verify exists.",
          },
        },
      ],
      primitiveFamilies: {
        familyCount: 1,
        generatedCount: 1,
      },
    },
  );

  assert.equal(merged.tools.length, 2);
  assert.equal(merged.primitiveFamilies.generatedCount, 1);
});

test("load tool contract registry compiles primitive family entries from disk", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agent-tool-registry-"));
  writeFileSync(
    join(repoRoot, "registry.json"),
    JSON.stringify({
      schema: "agent-tool-contract-registry.v1",
      generatedAt: "2026-04-16T00:00:00.000Z",
      tools: [
        {
          toolId: "memory.context",
          kind: "mcp",
          command: "studio-brain-memory:context",
          purpose: "Memory context.",
          verificationCommand: "node stats.mjs",
          safeFailBehavior: "Fallback.",
          rollbackBehavior: "None.",
        },
      ],
    }),
    "utf8",
  );
  writeFileSync(
    join(repoRoot, "primitives.json"),
    JSON.stringify({
      schema: "agent-tool-primitive-family-registry.v1",
      families: [
        {
          familyId: "verify.family",
          builder: "playwright-smoke-verifier",
          defaults: {
            kind: "repo-script",
            sideEffects: "artifact_only",
            dryRunSupport: true,
            safeFailBehavior: "Stop.",
            rollbackBehavior: "None.",
            lifecycle: {
              owner: "qa-platform",
              class: "adapter",
              reviewEveryDays: 21,
              lastReviewedAt: "2026-04-16T00:00:00.000Z",
              nativeAlternative: "playwright-visual-verification",
              retireWhen: "Native verify exists.",
            },
          },
          entries: [
            {
              toolId: "verify.portal",
              purpose: "Verify portal.",
              script: "./scripts/portal-playwright-smoke.mjs",
              baseUrl: "https://portal.monsoonfire.com",
              outputDir: "output/playwright/portal/prod",
            },
          ],
        },
        {
          familyId: "verify.native-browser-shadow",
          builder: "native-browser-shadow-verifier",
          defaults: {
            kind: "runtime-primitive",
            selectableByAgent: false,
            sideEffects: "artifact_only",
            dryRunSupport: true,
            safeFailBehavior: "Keep advisory.",
            rollbackBehavior: "None.",
            script: "./scripts/native-browser-shadow-verifier.mjs",
          },
          entries: [
            {
              "toolId": "verify.portal.native-browser.shadow",
              "purpose": "Prepare portal shadow verification.",
              "surface": "portal",
              "baseUrl": "https://portal.monsoonfire.com",
              "outputDir": "output/native-browser/portal/prod",
              "canonicalArtifactRoot": "output/playwright/portal/prod",
              "shadowOf": "verify.portal.smoke"
            }
          ]
        },
        {
          familyId: "verify.native-browser-shadow-exec",
          builder: "native-browser-shadow-verifier",
          defaults: {
            kind: "runtime-primitive",
            selectableByAgent: false,
            sideEffects: "artifact_only",
            dryRunSupport: true,
            safeFailBehavior: "Keep advisory.",
            rollbackBehavior: "None.",
            script: "./scripts/native-browser-shadow-verifier.mjs",
            execute: true
          },
          entries: [
            {
              "toolId": "verify.website.native-browser.shadow.exec",
              "purpose": "Execute website shadow verification.",
              "surface": "website",
              "baseUrl": "https://monsoonfire.com",
              "outputDir": "output/native-browser/website/prod",
              "canonicalArtifactRoot": "output/playwright/prod",
              "shadowOf": "verify.website.smoke",
              "expectedPortalHost": "portal.monsoonfire.com"
            }
          ]
        },
      ],
    }),
    "utf8",
  );

  const loaded = loadToolContractRegistry(repoRoot, "registry.json", "primitives.json");
  assert.equal(loaded.registry.tools.length, 4);
  assert.equal(loaded.registry.primitiveFamilies.generatedCount, 3);
  assert.equal(loaded.primitiveRelativePath, "primitives.json");
});
