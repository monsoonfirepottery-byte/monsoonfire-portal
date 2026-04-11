import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { spawn } from "node:child_process";
import {
  createAssociationScoutFromEnv,
  describeAssociationScoutEnv,
  type AssociationScoutBundle,
} from "./associationScout";

function createBundle(): AssociationScoutBundle {
  return {
    runId: "dream-run-1",
    mode: "idle",
    bundleId: "bundle-1",
    bundleType: "theme-cluster",
    themeType: "workflow",
    themeKey: "approval-summary",
    focusAreas: ["approval summary"],
    rows: [
      {
        id: "mem-1",
        source: "manual",
        memoryLayer: "episodic",
        status: "accepted",
        content: "Summarize approvals before suggesting next actions.",
        sourceConfidence: 0.9,
        importance: 0.8,
        tags: ["decision"],
        metadata: {
          entityHints: ["role:operator"],
          patternHints: ["workflow:approval-summary"],
        },
      },
      {
        id: "mem-2",
        source: "repo-markdown",
        memoryLayer: "canonical",
        status: "accepted",
        content: "Runbook note: approvals get a compact summary first.",
        sourceConfidence: 0.84,
        importance: 0.78,
        tags: ["runbook"],
        metadata: {
          lineageKey: "repo-1",
          entityHints: ["role:operator"],
          patternHints: ["workflow:approval-summary"],
        },
      },
    ],
  };
}

test("describeAssociationScoutEnv prefers codex auth in auto mode and migrates the legacy API model", () => {
  const availability = describeAssociationScoutEnv({
    STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_ENABLED: "true",
    STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_PROVIDER: "auto",
    STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MODEL: "gpt-4.1-mini",
    STUDIO_BRAIN_DISCORD_CODEX_EXECUTABLE: "codex",
    STUDIO_BRAIN_DISCORD_CODEX_MODEL: "gpt-5.4",
    STUDIO_BRAIN_DISCORD_CODEX_REASONING_EFFORT: "medium",
  });

  assert.equal(availability.available, true);
  assert.equal(availability.provider, "auto");
  assert.equal(availability.resolvedProvider, "codex-cli");
  assert.equal(availability.model, "gpt-5.4");
  assert.equal(availability.codexExecutable, "codex");
  assert.equal(availability.reasoningEffort, "medium");
  assert.equal(availability.reason, null);
});

test("createAssociationScoutFromEnv uses codex exec and strips direct API keys from the child environment", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "association-scout-test-"));
  const sourceCodexHome = join(tempRoot, "source-codex-home");
  const sourceAuthPath = join(sourceCodexHome, "auth.json");
  mkdirSync(sourceCodexHome, { recursive: true });
  writeFileSync(sourceAuthPath, JSON.stringify({ access_token: "chatgpt-session" }), "utf8");
  const captured: {
    command?: string;
    args?: string[];
    prompt?: string;
    schemaPath?: string;
    schemaBody?: string;
    childCodexHome?: string | undefined;
    childHome?: string | undefined;
    childAuthSnapshot?: string;
    envOpenAiKey?: string | undefined;
    envStudioBrainKey?: string | undefined;
  } = {};

  const fakeSpawn: typeof spawn = ((command, args, options) => {
    const child = new EventEmitter() as EventEmitter & {
      stdout: PassThrough;
      stderr: PassThrough;
      stdin: PassThrough;
      kill: () => void;
    };
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    child.stdin.end = ((chunk?: string) => {
      captured.command = String(command);
      captured.args = Array.isArray(args) ? args.map((entry) => String(entry)) : [];
      captured.prompt = String(chunk ?? "");
      captured.envOpenAiKey = options?.env?.OPENAI_API_KEY;
      captured.envStudioBrainKey = options?.env?.STUDIO_BRAIN_OPENAI_API_KEY;
      captured.childCodexHome = options?.env?.CODEX_HOME;
      captured.childHome = options?.env?.HOME;
      captured.childAuthSnapshot =
        captured.childCodexHome && existsSync(join(captured.childCodexHome, "auth.json"))
          ? readFileSync(join(captured.childCodexHome, "auth.json"), "utf8")
          : "";
      const schemaIndex = captured.args.indexOf("--output-schema");
      const outputIndex = captured.args.indexOf("-o");
      captured.schemaPath = schemaIndex >= 0 ? captured.args[schemaIndex + 1] : "";
      captured.schemaBody =
        captured.schemaPath && existsSync(captured.schemaPath)
          ? readFileSync(captured.schemaPath, "utf8")
          : "";
      const outputPath = outputIndex >= 0 ? captured.args[outputIndex + 1] : "";
      if (outputPath) {
        writeFileSync(
          outputPath,
          `${JSON.stringify({
            theme: "approval summary before action",
            summary: "These memories describe the same approval-summary habit.",
            confidence: 0.82,
            contradictions: [],
            followUpQueries: ["approval summary runbook"],
            intents: [
              {
                type: "connection_note",
                confidence: 0.84,
                title: "approval summary thread",
                explanation: "Link the operator habit to the runbook fragment.",
                memoryIds: ["mem-1", "mem-2"],
                targetIds: [],
                relationType: null,
                query: null,
                recommendation: null,
              },
            ],
          })}\n`,
          "utf8",
        );
      }
      process.nextTick(() => {
        child.stdout.end();
        child.stderr.end();
        child.emit("close", 0);
      });
      return child.stdin;
    }) as typeof child.stdin.end;
    return child as unknown as ReturnType<typeof spawn>;
  }) as typeof spawn;

  try {
    const scout = createAssociationScoutFromEnv(
      {
        STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_ENABLED: "true",
        STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_PROVIDER: "codex-cli",
        STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_EXECUTABLE: "codex",
        STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_EXEC_ROOT: tempRoot,
        STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_MODEL: "gpt-5.4",
        STUDIO_BRAIN_MEMORY_CONSOLIDATION_ASSOCIATION_SCOUT_CODEX_REASONING_EFFORT: "low",
        CODEX_HOME: sourceCodexHome,
        OPENAI_API_KEY: "sk-platform-should-not-pass-through",
        STUDIO_BRAIN_OPENAI_API_KEY: "sk-studio-brain-should-not-pass-through",
      },
      { spawnImpl: fakeSpawn },
    );
    assert.ok(scout);

    const proposal = await scout?.scout(createBundle());
    assert.ok(proposal);
    assert.equal(proposal?.provider, "codex.exec");
    assert.equal(proposal?.model, "gpt-5.4");
    assert.equal(proposal?.intents[0]?.type, "connection_note");
    assert.equal(captured.command, "codex");
    assert.equal(captured.envOpenAiKey, undefined);
    assert.equal(captured.envStudioBrainKey, undefined);
    assert.notEqual(captured.childCodexHome, sourceCodexHome);
    assert.notEqual(captured.childHome, process.env.HOME ?? process.env.USERPROFILE ?? "");
    assert.match(String(captured.childAuthSnapshot || ""), /chatgpt-session/);
    assert.equal(Boolean(captured.prompt?.includes("\"bundleId\":\"bundle-1\"")), true);
    assert.equal(Boolean(captured.args?.includes("--output-schema")), true);
    assert.equal(Boolean(captured.args?.includes("-o")), true);
    assert.equal(Boolean(captured.args?.includes("-m")), true);
    assert.equal(
      Boolean(captured.args?.includes("mcp_servers.open_memory.enabled=false")),
      false,
    );
    assert.equal(
      Boolean(captured.args?.includes("mcp_servers.studio-brain-memory.enabled=false")),
      false,
    );
    assert.equal(Boolean(captured.schemaPath), true);
    assert.match(String(captured.schemaBody || ""), /followUpQueries/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
