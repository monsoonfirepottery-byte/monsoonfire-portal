import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildPreflightReport, matchesPattern } from "./swarm_lane_preflight.mjs";
import { validateJsonSchema } from "./validate_ops_artifacts.mjs";

function fakeGit(responses) {
  return (args) => {
    const key = args.join(" ");
    return responses[key] || { ok: true, stdout: "", stderr: "", status: 0 };
  };
}

test("matchesPattern supports exact and prefix ownership patterns", () => {
  assert.equal(matchesPattern("docs/ops/admin.md", "docs/ops/**"), true);
  assert.equal(matchesPattern("docs/ops/admin.md", "docs/*"), false);
  assert.equal(matchesPattern("Makefile", "Makefile"), true);
  assert.equal(matchesPattern("scripts/other.sh", "scripts/ops/**"), false);
});

test("buildPreflightReport passes for scoped clean lane changes", () => {
  const report = buildPreflightReport(
    { lane: "docs", base: "origin/main" },
    fakeGit({
      "rev-parse --abbrev-ref HEAD": { ok: true, stdout: "codex/docs-lane", stderr: "", status: 0 },
      "diff --name-only --no-renames origin/main...HEAD": { ok: true, stdout: "docs/ops/admin.md\n", stderr: "", status: 0 },
      "status --short": { ok: true, stdout: "", stderr: "", status: 0 },
    }),
  );

  assert.equal(report.status, "pass");
  assert.deepEqual(report.outsideScope, []);
});

test("buildPreflightReport stays compatible with its JSON schema", () => {
  const report = buildPreflightReport(
    { lane: "tooling", base: "origin/main" },
    fakeGit({
      "rev-parse --abbrev-ref HEAD": { ok: true, stdout: "codex/tooling-lane", stderr: "", status: 0 },
      "diff --name-only --no-renames origin/main...HEAD": { ok: true, stdout: "scripts/ops/swarm_lane_preflight.mjs\n", stderr: "", status: 0 },
      "status --short": { ok: true, stdout: "", stderr: "", status: 0 },
    }),
  );
  const schema = JSON.parse(readFileSync("schemas/ops/swarm-lane-preflight.v1.schema.json", "utf8"));

  assert.deepEqual(validateJsonSchema(report, schema), []);
});

test("buildPreflightReport fails for out-of-lane files and can fail on dirty state", () => {
  const report = buildPreflightReport(
    { lane: "docs", base: "origin/main", failOnDirty: true },
    fakeGit({
      "rev-parse --abbrev-ref HEAD": { ok: true, stdout: "codex/docs-lane", stderr: "", status: 0 },
      "diff --name-only --no-renames origin/main...HEAD": { ok: true, stdout: "docs/ops/admin.md\nserver/app.ts\n", stderr: "", status: 0 },
      "status --short": { ok: true, stdout: " M docs/ops/admin.md\n", stderr: "", status: 0 },
    }),
  );

  assert.equal(report.status, "fail");
  assert.deepEqual(report.outsideScope, ["server/app.ts"]);
  assert.ok(report.problems.some((problem) => problem.includes("dirty worktree")));
});

test("buildPreflightReport includes rename sources in scope checks", () => {
  const report = buildPreflightReport(
    { lane: "docs", base: "origin/main" },
    fakeGit({
      "rev-parse --abbrev-ref HEAD": { ok: true, stdout: "codex/docs-lane", stderr: "", status: 0 },
      "diff --name-only --no-renames origin/main...HEAD": { ok: true, stdout: "docs/ops/app.md\n", stderr: "", status: 0 },
      "status --short": { ok: true, stdout: "R  server/app.ts -> docs/ops/app.md\n", stderr: "", status: 0 },
    }),
  );

  assert.equal(report.status, "fail");
  assert.ok(report.dirtyFiles.includes("server/app.ts"));
  assert.ok(report.dirtyFiles.includes("docs/ops/app.md"));
  assert.deepEqual(report.outsideScope, ["server/app.ts"]);
});

test("buildPreflightReport warns when upstream base differs from origin main", () => {
  const report = buildPreflightReport(
    { lane: "docs" },
    fakeGit({
      "rev-parse --abbrev-ref HEAD": { ok: true, stdout: "codex/docs-lane", stderr: "", status: 0 },
      "rev-parse --abbrev-ref --symbolic-full-name @{u}": {
        ok: true,
        stdout: "origin/codex/stack-base",
        stderr: "",
        status: 0,
      },
      "diff --name-only --no-renames origin/codex/stack-base...HEAD": { ok: true, stdout: "docs/ops/admin.md\n", stderr: "", status: 0 },
      "diff --name-only --no-renames origin/main...HEAD": { ok: true, stdout: "docs/ops/admin.md\n", stderr: "", status: 0 },
      "status --short": { ok: true, stdout: "", stderr: "", status: 0 },
    }),
  );

  assert.equal(report.status, "warn");
  assert.equal(report.integrationBase.differs, true);
  assert.ok(report.warnings.some((warning) => warning.includes("differs from origin/main")));
  assert.equal(report.recommendation, "review the stacked base warning and confirm integration order before delegating");
});

test("buildPreflightReport keeps dirty warning recommendation specific to dirty files", () => {
  const report = buildPreflightReport(
    { lane: "docs", base: "origin/main" },
    fakeGit({
      "rev-parse --abbrev-ref HEAD": { ok: true, stdout: "codex/docs-lane", stderr: "", status: 0 },
      "diff --name-only --no-renames origin/main...HEAD": { ok: true, stdout: "docs/ops/admin.md\n", stderr: "", status: 0 },
      "status --short": { ok: true, stdout: " M docs/ops/admin.md\n", stderr: "", status: 0 },
    }),
  );

  assert.equal(report.status, "warn");
  assert.equal(report.recommendation, "commit, stash, or intentionally account for dirty files before delegating");
});
