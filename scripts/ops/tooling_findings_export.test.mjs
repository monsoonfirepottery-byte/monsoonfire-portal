import test from "node:test";
import assert from "node:assert/strict";

import { buildReport, normalizeFinding, renderMarkdown } from "./tooling_findings_export.mjs";

test("normalizeFinding marks missing tools as coverage gaps", () => {
  const finding = normalizeFinding(
    { id: "actionlint", tool: "actionlint" },
    { code: "tool_missing", message: "actionlint is not installed." },
  );

  assert.equal(finding.coverageGap, true);
  assert.equal(finding.toolId, "actionlint");
});

test("buildReport converts actionable findings into issue-ready tasks", () => {
  const report = buildReport({
    toolingReport: "output/ops/tooling-quality/tooling-quality-latest.json",
    reportObject: {
      schema: "studiobrain-ops-tooling-quality-report.v1",
      generatedAt: "2026-05-07T00:00:00.000Z",
      status: "warn",
      sections: [
        {
          id: "shellcheck",
          tool: "npx shellcheck",
          findings: [
            {
              file: "scripts/ops/example.sh",
              line: 7,
              column: 3,
              code: "SC2155",
              severity: "warning",
              message: "Declare and assign separately.",
            },
          ],
        },
        {
          id: "actionlint",
          tool: "actionlint",
          findings: [{ code: "tool_missing", message: "actionlint is not installed." }],
        },
      ],
    },
  });

  assert.equal(report.status, "warn");
  assert.equal(report.summary.findings, 2);
  assert.equal(report.summary.actionableFindings, 1);
  assert.equal(report.summary.coverageGaps, 1);
  assert.equal(report.summary.issueReadyTasks, 1);
  assert.equal(report.tasks[0].title, "[ops-tooling] Review shellcheck findings");
});

test("renderMarkdown emits GitHub-copy-ready task sections", () => {
  const report = buildReport({
    reportObject: {
      sections: [
        {
          id: "sqlfluff",
          tool: "uv sqlfluff",
          findings: [{ file: "scripts/ops/review.sql", code: "parse_error", message: "SQL parse failed." }],
        },
      ],
    },
  });
  const markdown = renderMarkdown(report);

  assert.match(markdown, /## Problem/);
  assert.match(markdown, /## Acceptance Criteria/);
  assert.match(markdown, /scripts\/ops\/review\.sql parse_error/);
});
