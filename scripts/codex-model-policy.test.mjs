import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildCodexModelPolicyReport } from "./codex-model-policy.mjs";

test("model policy report resolves role selection and env overrides", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-model-policy-"));
  mkdirSync(join(repoRoot, "config"), { recursive: true });
  writeFileSync(
    join(repoRoot, "config", "codex-model-policy.json"),
    JSON.stringify({
      schema: "codex-model-policy.v1",
      roles: {
        implementation_default: {
          preferred: ["gpt-5.5", "gpt-5.4"],
          reasoningEffort: "medium",
          fallback: "gpt-5.4",
        },
        planning_deep: {
          preferred: ["gpt-5.5"],
          reasoningEffort: "high",
          fallback: "gpt-5.4",
        },
      },
    }),
    "utf8",
  );

  const report = buildCodexModelPolicyReport({
    repoRoot,
    role: "implementation_default",
    generatedAt: "2026-04-24T00:00:00.000Z",
    env: {
      CODEX_MODEL_IMPLEMENTATION_DEFAULT: "gpt-5.4",
    },
  });

  assert.equal(report.status, "pass");
  assert.equal(report.selection.model, "gpt-5.4");
  assert.equal(report.resolved.roles.planning_deep.reasoningEffort, "high");
});
