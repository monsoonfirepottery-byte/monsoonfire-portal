import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildPrStackAudit, renderMarkdown } from "./pr_stack_audit.mjs";
import { validateJsonSchema } from "./validate_ops_artifacts.mjs";

const repos = [
  { id: "portal", label: "Portal", repo: "owner/portal" },
  { id: "mission-control", label: "Mission Control", repo: "owner/mission-control" },
];

const fixture = {
  repos: [
    {
      id: "portal",
      label: "Portal",
      repo: "owner/portal",
      collection: { openStatus: "pass", mergedStatus: "pass", openError: "", mergedError: "" },
      openPullRequests: [
        {
          number: 647,
          title: "[ops] Show packet outcomes in PR readiness",
          headRefName: "codex/ops-pr-readiness-packet-outcomes-wave2",
          baseRefName: "codex/ops-packet-outcome-churn-wave2",
          isDraft: true,
          mergeStateStatus: "UNKNOWN",
          updatedAt: "2026-05-07T16:55:00Z",
          url: "https://example.test/pr/647",
          author: { login: "codex" },
        },
        {
          number: 646,
          title: "[ops] Warn on packet outcome churn",
          headRefName: "codex/ops-packet-outcome-churn-wave2",
          baseRefName: "codex/ops-packet-outcome-report-wave2",
          isDraft: true,
          mergeStateStatus: "UNKNOWN",
          updatedAt: "2026-05-07T16:40:00Z",
          url: "https://example.test/pr/646",
          author: { login: "codex" },
        },
        {
          number: 552,
          title: "chore(deps): bump ip-address",
          headRefName: "dependabot/npm_and_yarn/studio-brain/ip-address-10.2.0",
          baseRefName: "main",
          isDraft: false,
          mergeStateStatus: "BEHIND",
          updatedAt: "2026-05-06T12:00:00Z",
          url: "https://example.test/pr/552",
          author: { login: "dependabot" },
        },
        {
          number: 530,
          title: "[codex] Add polished firing care preview site",
          headRefName: "codex/firing-care-preview-copy-polish",
          baseRefName: "main",
          isDraft: true,
          mergeStateStatus: "DIRTY",
          updatedAt: "2026-05-04T12:00:00Z",
          url: "https://example.test/pr/530",
          author: { login: "codex" },
        },
      ],
      recentlyMerged: [
        {
          number: 645,
          title: "[ops] Refresh packet outcomes in wave runner",
          headRefName: "codex/ops-wave-runner-packet-outcomes-wave2",
          baseRefName: "codex/ops-packet-outcome-report-wave2",
          mergedAt: "2026-05-07T16:45:00Z",
          mergeCommit: { oid: "abc123" },
          url: "https://example.test/pr/645",
          author: { login: "codex" },
        },
      ],
    },
    {
      id: "mission-control",
      label: "Mission Control",
      repo: "owner/mission-control",
      collection: { openStatus: "pass", mergedStatus: "pass", openError: "", mergedError: "" },
      openPullRequests: [],
      recentlyMerged: [],
    },
  ],
};

test("buildPrStackAudit classifies current PR lanes and stack edges", () => {
  const report = buildPrStackAudit(fixture, { generatedAt: "2026-05-07T17:00:00.000Z", runId: "test-pr-stack", repos, openLimit: 40 });

  assert.equal(report.schema, "studiobrain-ops-pr-stack-audit.v1");
  assert.equal(report.readOnly, true);
  assert.equal(report.summary.open, 4);
  assert.equal(report.summary.categories.stacked, 2);
  assert.equal(report.summary.categories.dependency, 1);
  assert.equal(report.summary.categories.conflict, 1);
  assert.equal(report.repos[0].summary.openLimitReached, false);
  assert.equal(report.stackEdges.length, 1);
  assert.equal(report.stackEdges[0].basePr, 646);
  assert.equal(report.stackEdges[0].childPr, 647);
  assert.equal(report.mergePlan.status, "blocked");
  assert.equal(report.mergePlan.readyCount, 0);
  assert.equal(report.mergePlan.blockedCount, 4);
  assert.equal(report.repos[0].openPullRequests[0].mergeReadiness.baseDependencyPr, 646);
  assert.ok(report.repos[0].openPullRequests[0].mergeReadiness.blockers.includes("base_pr_open:#646"));
  assert.ok(report.warnings.some((warning) => warning.includes("dirty/conflicted")));
  assert.ok(report.warnings.some((warning) => warning.includes("dependency PRs")));

  const markdown = renderMarkdown(report);
  assert.match(markdown, /Ops PR Stack Audit/);
  assert.match(markdown, /#646/);
  assert.match(markdown, /#647/);
  assert.match(markdown, /Stacked Edges/);
  assert.match(markdown, /Merge Readiness/);
  assert.match(markdown, /base_pr_open:#646/);
  assert.match(markdown, /dependency/);
});

test("buildPrStackAudit exposes the next clean merge candidate", () => {
  const cleanFixture = structuredClone(fixture);
  cleanFixture.repos[0].openPullRequests.push({
    number: 660,
    title: "[ops] Ready small diagnostics",
    headRefName: "codex/ops-ready-diagnostics",
    baseRefName: "main",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    updatedAt: "2026-05-07T17:00:00Z",
    url: "https://example.test/pr/660",
    author: { login: "codex" },
  });

  const report = buildPrStackAudit(cleanFixture, { generatedAt: "2026-05-07T17:00:00.000Z", runId: "test-pr-stack", repos, openLimit: 40 });

  assert.equal(report.mergePlan.status, "candidate_ready");
  assert.equal(report.mergePlan.readyCount, 1);
  assert.equal(report.mergePlan.nextMergeCandidate.number, 660);
  assert.equal(report.mergePlan.nextMergeCandidate.headRefName, "codex/ops-ready-diagnostics");
  assert.match(renderMarkdown(report), /Next merge candidate: \[#660\]/);
});

test("buildPrStackAudit stays compatible with its JSON schema", () => {
  const report = buildPrStackAudit(fixture, { generatedAt: "2026-05-07T17:00:00.000Z", runId: "test-pr-stack", repos, openLimit: 40 });
  const schema = JSON.parse(readFileSync("schemas/ops/pr-stack-audit.v1.schema.json", "utf8"));

  assert.deepEqual(validateJsonSchema(report, schema), []);
});

test("buildPrStackAudit warns when open PR collection reaches the configured limit", () => {
  const report = buildPrStackAudit(fixture, { generatedAt: "2026-05-07T17:00:00.000Z", runId: "test-pr-stack", repos, openLimit: 4 });

  assert.equal(report.status, "warn");
  assert.equal(report.repos[0].summary.openLimitReached, true);
  assert.ok(report.warnings.some((warning) => warning.includes("reached limit 4")));
});
