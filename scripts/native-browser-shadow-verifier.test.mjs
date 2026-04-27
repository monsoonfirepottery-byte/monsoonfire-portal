import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCodexExecArgs,
  buildExecutionPrompt,
  buildExecutionSchema,
  parseArgs,
} from "./native-browser-shadow-verifier.mjs";

test("parseArgs enables execute mode and codex exec defaults", () => {
  const parsed = parseArgs([
    "--surface",
    "website",
    "--execute",
    "--model",
    "gpt-5.4-mini",
    "--reasoning-effort",
    "low",
    "--timeout-ms",
    "90000",
  ]);

  assert.equal(parsed.surface, "website");
  assert.equal(parsed.execute, true);
  assert.equal(parsed.mode, "execute");
  assert.equal(parsed.model, "gpt-5.4-mini");
  assert.equal(parsed.reasoningEffort, "low");
  assert.equal(parsed.timeoutMs, 90000);
});

test("parseArgs supports Codex app handoff mode without executing", () => {
  const parsed = parseArgs(["--surface", "portal", "--app-handoff"]);
  assert.equal(parsed.surface, "portal");
  assert.equal(parsed.execute, false);
  assert.equal(parsed.mode, "app-handoff");
});

test("buildExecutionSchema requires bounded native-browser result fields", () => {
  const schema = buildExecutionSchema();
  assert.equal(schema.type, "object");
  assert.equal(schema.required.includes("browserCapability"), true);
  assert.equal(schema.required.includes("checks"), true);
  assert.equal(schema.properties.status.enum.includes("tool_unavailable"), true);
});

test("buildCodexExecArgs enables JSONL telemetry while preserving output schema", () => {
  const args = buildCodexExecArgs({
    executionRoot: "C:/Windows/Temp",
    model: "gpt-5.4-mini",
    outputPath: "C:/Windows/Temp/last-message.txt",
    outputSchemaPath: "C:/Windows/Temp/schema.json",
    reasoningEffort: "low",
  });

  assert.equal(args[0], "exec");
  assert.ok(args.includes("--json"));
  assert.ok(args.includes("--output-schema"));
  assert.ok(args.includes("-o"));
  assert.ok(args.includes("web_search=\"disabled\""));
});

test("buildExecutionPrompt fences codex exec to native browser work only", () => {
  const prompt = buildExecutionPrompt(
    {
      surface: "portal",
      baseUrl: "https://portal.monsoonfire.com",
      shadowOf: "verify.portal.smoke",
      checks: ["Confirm the dashboard heading renders."],
      recommendedScreenshots: ["portal-dashboard-desktop.png"],
    },
    { surface: "portal" },
  );

  assert.match(prompt, /Use the Codex in-app browser or computer-use surface/i);
  assert.match(prompt, /Do not use shell commands/i);
  assert.match(prompt, /Do not write files/i);
  assert.match(prompt, /tool_unavailable/i);
});
