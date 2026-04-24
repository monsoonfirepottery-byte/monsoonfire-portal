import assert from "node:assert/strict";
import test from "node:test";

import { buildExecutionPrompt, buildExecutionSchema, parseArgs } from "./native-browser-shadow-verifier.mjs";

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
  assert.equal(parsed.model, "gpt-5.4-mini");
  assert.equal(parsed.reasoningEffort, "low");
  assert.equal(parsed.timeoutMs, 90000);
});

test("buildExecutionSchema requires bounded native-browser result fields", () => {
  const schema = buildExecutionSchema();
  assert.equal(schema.type, "object");
  assert.equal(schema.required.includes("browserCapability"), true);
  assert.equal(schema.required.includes("checks"), true);
  assert.equal(schema.properties.status.enum.includes("tool_unavailable"), true);
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
