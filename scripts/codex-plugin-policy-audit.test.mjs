import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { auditCodexPluginPolicy } from "./codex-plugin-policy-audit.mjs";

test("plugin policy audit accepts explicit connector boundaries", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-plugin-policy-"));
  mkdirSync(join(repoRoot, "config"), { recursive: true });
  writeFileSync(
    join(repoRoot, "config", "codex-plugin-policy.json"),
    JSON.stringify({
      schema: "codex-plugin-boundary-policy.v1",
      defaults: {
        writePolicy: "explicit_confirmation",
        memoryIngress: "redacted_only",
      },
      plugins: [
        {
          pluginId: "browser-use",
          connectorId: "openai-bundled/browser-use",
          category: "local-browser",
          allowedTasks: ["local browser verification"],
          forbiddenData: ["raw secrets"],
          writePolicy: "artifact_only",
          memoryIngress: "artifact_summary_only",
          approvalPolicy: "no_approval",
        },
        {
          pluginId: "gmail",
          connectorId: "openai-curated/gmail",
          category: "mailbox",
          allowedTasks: ["thread summary"],
          forbiddenData: ["password reset links"],
          writePolicy: "explicit_confirmation",
          memoryIngress: "redacted_only",
          approvalPolicy: "human_required_for_mutation",
        },
      ],
    }),
    "utf8",
  );

  const report = auditCodexPluginPolicy({ repoRoot, strict: true });

  assert.equal(report.status, "pass");
  assert.equal(report.summary.plugins, 2);
});

test("plugin policy audit rejects unsafe sensitive memory ingress", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-plugin-policy-bad-"));
  mkdirSync(join(repoRoot, "config"), { recursive: true });
  writeFileSync(
    join(repoRoot, "config", "codex-plugin-policy.json"),
    JSON.stringify({
      schema: "codex-plugin-boundary-policy.v1",
      plugins: [
        {
          pluginId: "gmail",
          connectorId: "openai-curated/gmail",
          category: "mailbox",
          allowedTasks: ["thread summary"],
          forbiddenData: ["password reset links"],
          writePolicy: "explicit_confirmation",
          memoryIngress: "allowed",
          approvalPolicy: "no_approval",
        },
      ],
    }),
    "utf8",
  );

  const report = auditCodexPluginPolicy({ repoRoot, strict: true });

  assert.equal(report.status, "fail");
  assert.equal(report.findings.some((finding) => /Sensitive connector/.test(finding.message)), true);
  assert.equal(report.findings.some((finding) => /Mutating plugin boundary/.test(finding.message)), true);
});
