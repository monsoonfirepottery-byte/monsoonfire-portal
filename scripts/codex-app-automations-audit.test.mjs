import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { auditCodexAppAutomations } from "./codex-app-automations-audit.mjs";

test("auditCodexAppAutomations accepts the repo manifest", () => {
  const report = auditCodexAppAutomations({ strict: true });
  assert.equal(report.status, "pass");
  assert.equal(report.summary.automations >= 5, true);
});

test("auditCodexAppAutomations flags duplicate ids and unsafe approval policy", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "codex-automations-"));
  try {
    writeFileSync(
      join(repoRoot, "package.json"),
      JSON.stringify({
        scripts: {
          "deploy:namecheap:portal:live": "node deploy.mjs",
          "codex:doctor": "node doctor.mjs",
        },
      }),
      "utf8",
    );
    writeFileSync(
      join(repoRoot, "manifest.json"),
      `${JSON.stringify(
        {
          schema: "codex-app-automation-manifest.v1",
          automations: [
            {
              automationId: "dup",
              title: "Deploy",
              schedule: "* * * * *",
              command: "npm run deploy:namecheap:portal:live",
              riskLane: "background",
              approvalPolicy: "auto_review_ok",
              dedupeKey: "same",
              requiredArtifacts: ["output/deploy.json"],
              successCriteria: ["ok"],
            },
            {
              automationId: "dup",
              title: "Other",
              schedule: "* * * * *",
              command: "npm run codex:doctor",
              riskLane: "background",
              approvalPolicy: "no_approval",
              dedupeKey: "same",
              requiredArtifacts: ["output/doctor.json"],
              successCriteria: ["ok"],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const report = auditCodexAppAutomations({
      repoRoot,
      manifestPath: "manifest.json",
      strict: true,
    });
    assert.equal(report.status, "fail");
    assert.equal(report.findings.some((finding) => /Duplicate automationId/.test(finding.message)), true);
    assert.equal(report.findings.some((finding) => /approval policy/.test(finding.message)), true);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
