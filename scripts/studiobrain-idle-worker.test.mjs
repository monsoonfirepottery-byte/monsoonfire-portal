import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildJobPlan, parseArgs, runIdleWorker } from "./studiobrain-idle-worker.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function tempRunRoot() {
  return mkdtempSync(join(tmpdir(), "studiobrain-idle-worker-"));
}

test("parseArgs expands the overnight profile into memory, repo, and harness budgets", () => {
  const options = parseArgs(["--profile", "overnight", "--jobs", "memory,repo,harness", "--dry-run"]);

  assert.equal(options.profile, "overnight");
  assert.equal(options.memoryMode, "overnight");
  assert.equal(options.repoDepth, "standard");
  assert.deepEqual(options.jobs, ["memory", "repo", "harness"]);
  assert.equal(options.dryRun, true);
  assert.equal(options.wikiMode, "check");
  assert.ok(options.memoryMaxCandidates > 100);
  assert.ok(options.memoryMaxWrites > 25);
});

test("parseArgs includes the wiki information lane by default", () => {
  const options = parseArgs(["--dry-run"]);

  assert.deepEqual(options.jobs, ["memory", "repo", "harness", "wiki"]);
  assert.equal(options.wikiMode, "check");
});

test("buildJobPlan creates bounded memory, quick repo, and harness jobs", () => {
  const runRoot = tempRunRoot();
  try {
    const options = parseArgs(["--profile", "idle", "--jobs", "memory,repo,harness", "--run-root", runRoot]);
    const plan = buildJobPlan(options, "idle-test-run");

    assert.deepEqual(
      plan.map((job) => job.id),
      [
        "memory-consolidation",
        "repo-agentic-health-inventory",
        "repo-ephemeral-artifact-guard",
        "agent-harness-work-packet",
      ],
    );
    assert.deepEqual(plan[0].command.slice(0, 4), ["node", "./scripts/open-memory-consolidate.mjs", "--mode", "idle"]);
    assert.match(plan[1].command.join(" "), /repo-audit-branch-guard/);
    assert.match(plan[1].command.join(" "), /--untracked-files no/);
    assert.match(plan[1].command.join(" "), /--quiet-command/);
    assert.match(plan[1].command.join(" "), /audit:agentic:inventory/);
    assert.equal(plan[1].command.includes("--json"), true);
    assert.ok(plan[1].artifacts.some((artifact) => artifact.endsWith("repo-agentic-health-inventory.json")));
    assert.ok(plan[1].artifacts.some((artifact) => artifact.endsWith("repo-agentic-health-inventory.md")));
    assert.ok(plan[2].artifacts.some((artifact) => artifact.endsWith("ephemeral-artifact-tracking-guard.json")));
    assert.match(plan[3].command.join(" "), /studio:ops:agent-harness/);
    assert.ok(plan[3].artifacts.some((artifact) => artifact.endsWith("agent-harness/next-work.json")));
    assert.ok(plan[3].artifacts.some((artifact) => artifact.endsWith("agent-harness/success-metrics.json")));
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("buildJobPlan creates report-only wiki information lane jobs", () => {
  const runRoot = tempRunRoot();
  try {
    const options = parseArgs(["--profile", "idle", "--jobs", "wiki", "--run-root", runRoot]);
    const plan = buildJobPlan(options, "wiki-test-run");

    assert.deepEqual(plan.map((job) => job.id), [
      "wiki-source-index-check",
      "wiki-claim-extraction-check",
      "wiki-contradiction-scan",
      "wiki-context-pack-refresh",
      "wiki-export-drift-check",
      "wiki-idle-task-queue",
      "wiki-db-probe-plan",
    ]);
    assert.match(plan[0].command.join(" "), /wiki:source:index:check/);
    assert.match(plan[1].command.join(" "), /wiki:extract:check/);
    assert.match(plan[2].command.join(" "), /wiki:contradictions:scan/);
    assert.match(plan[3].command.join(" "), /wiki:context:check/);
    assert.match(plan[4].command.join(" "), /wiki:export:drift/);
    assert.match(plan[5].command.join(" "), /wiki:idle-tasks:check/);
    assert.match(plan[6].command.join(" "), /wiki:db:probe/);
    assert.equal(plan.every((job) => job.category === "repo"), true);
    assert.ok(plan[0].artifacts.some((artifact) => artifact.endsWith("wiki-source-index.json")));
    assert.ok(plan[1].artifacts.some((artifact) => artifact.endsWith("wiki-claim-extraction.json")));
    assert.ok(plan[2].artifacts.some((artifact) => artifact.endsWith("wiki-contradictions.json")));
    assert.ok(plan[3].artifacts.some((artifact) => artifact.endsWith("wiki-context-pack.json")));
    assert.ok(plan[4].artifacts.some((artifact) => artifact.endsWith("wiki-export-drift.json")));
    assert.ok(plan[5].artifacts.some((artifact) => artifact.endsWith("wiki-idle-tasks.json")));
    assert.ok(plan[6].artifacts.some((artifact) => artifact.endsWith("wiki-db-probe.json")));
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("buildJobPlan can intentionally switch wiki lanes to apply mode", () => {
  const runRoot = tempRunRoot();
  try {
    const options = parseArgs(["--profile", "idle", "--jobs", "wiki", "--wiki-mode", "apply", "--run-root", runRoot]);
    const plan = buildJobPlan(options, "wiki-apply-test-run");

    assert.match(plan[0].command.join(" "), /wiki:source:index:apply/);
    assert.match(plan[1].command.join(" "), /wiki:extract:apply/);
    assert.match(plan[2].command.join(" "), /wiki:contradictions:record/);
    assert.match(plan[3].command.join(" "), /wiki:context:apply/);
    assert.match(plan[4].command.join(" "), /wiki:export:drift:record/);
    assert.match(plan[5].command.join(" "), /wiki:idle-tasks:apply/);
    assert.match(plan[6].command.join(" "), /wiki:db:probe:live/);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("deploy and install sync lists include idle worker repo-job dependencies", () => {
  const requiredFilenames = [
    "package.json",
    ".gitignore",
    "sshd.local",
    "install-studiobrain-fail2ban-sshd.sh",
    "open-memory-consolidate.mjs",
    "open-memory-overnight-iterate.mjs",
    "open-memory.mjs",
    "open-memory-automation.mjs",
    "studiobrain-ops.py",
    "studiobrain-idle-worker.mjs",
    "studiobrain-agent-harness-work-packet.mjs",
    "wiki-postgres.mjs",
    "wiki-postgres-utils.mjs",
    "repo-audit-branch-guard.mjs",
    "repo-agentic-health-inventory.mjs",
    "check-ephemeral-artifact-tracking.mjs",
    "firestore-write-surface-inventory.mjs",
    "destructive-command-surface-audit.mjs",
    "security-history-scan.mjs",
    "wiki",
  ];
  const supportLists = [
    ["deploy runtime support", readFileSync(join(REPO_ROOT, "scripts", "deploy-studio-brain-host.py"), "utf8")],
    ["ops stack support", readFileSync(join(REPO_ROOT, "scripts", "studiobrain-ops.py"), "utf8")],
  ];

  for (const [label, content] of supportLists) {
    for (const filename of requiredFilenames) {
      assert.match(content, new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${label} should sync ${filename}`);
    }
  }

  assert.match(supportLists[1][1], /"idleWorker": \{\{\}\}/);
  assert.match(supportLists[1][1], /studio-brain-idle-worker\.timer/);
  assert.match(supportLists[1][1], /studio-brain-idle-worker-overnight\.timer/);
  assert.match(supportLists[1][1], /NextElapseUSecMonotonic/);
  assert.match(supportLists[1][1], /list-timers/);
  assert.match(supportLists[1][1], /"timers": idle_timer_summaries/);
  assert.match(supportLists[1][1], /dirtyTrackedUnmanagedCount/);
  assert.match(supportLists[1][1], /untrackedUnmanagedCount/);
  assert.match(supportLists[1][1], /deploymentManaged/);
  assert.match(supportLists[1][1], /.env.integrity.json/);
  assert.match(supportLists[1][1], /latest idle worker artifact is not passing/);
  assert.doesNotMatch(supportLists[1][1], /STUDIO_BRAIN_DEPLOY_HOST', '127\.0\.0\.1/);
  assert.match(supportLists[1][1], /STUDIO_BRAIN_BASE_URL/);
});

test("runIdleWorker dry-run writes a planned report without executing jobs", async () => {
  const runRoot = tempRunRoot();
  try {
    const artifact = join(runRoot, "latest.json");
    const options = parseArgs([
      "--dry-run",
      "--skip-load-check",
      "--run-id",
      "dry-run-test",
      "--run-root",
      runRoot,
      "--artifact",
      artifact,
      "--lock-path",
      join(runRoot, "lock.json"),
    ]);

    const report = await runIdleWorker(options, {
      runner() {
        throw new Error("dry-run should not execute commands");
      },
    });

    assert.equal(report.status, "planned");
    assert.equal(report.jobs.every((job) => job.status === "planned"), true);
    assert.equal(existsSync(artifact), true);
    const written = JSON.parse(readFileSync(artifact, "utf8"));
    assert.equal(written.runId, "dry-run-test");
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("runIdleWorker continues repo jobs and reports degraded status after a command failure", async () => {
  const runRoot = tempRunRoot();
  try {
    const artifact = join(runRoot, "latest.json");
    const seen = [];
    const options = parseArgs([
      "--jobs",
      "repo",
      "--repo-depth",
      "quick",
      "--skip-load-check",
      "--run-id",
      "repo-failure-test",
      "--run-root",
      runRoot,
      "--artifact",
      artifact,
      "--lock-path",
      join(runRoot, "lock.json"),
    ]);

    const report = await runIdleWorker(options, {
      runner(program, args) {
        seen.push([program, args]);
        return seen.length === 2
          ? { status: 1, stdout: "", stderr: "simulated audit failure" }
          : { status: 0, stdout: "{\"status\":\"pass\"}", stderr: "" };
      },
    });

    assert.equal(seen.length, 2);
    assert.equal(report.status, "degraded");
    assert.equal(report.summary.passed, 1);
    assert.equal(report.summary.warning, 0);
    assert.equal(report.summary.failed, 1);
    assert.equal(report.jobs[1].stderrTail, "simulated audit failure");
    assert.equal(existsSync(options.lockPath), false);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("runIdleWorker promotes successful command payload warnings into the report status", async () => {
  const runRoot = tempRunRoot();
  try {
    const options = parseArgs([
      "--jobs",
      "memory",
      "--skip-load-check",
      "--run-id",
      "memory-warning-test",
      "--run-root",
      runRoot,
      "--artifact",
      join(runRoot, "latest.json"),
      "--lock-path",
      join(runRoot, "lock.json"),
    ]);

    const report = await runIdleWorker(options, {
      runner() {
        return {
          status: 0,
          stdout: JSON.stringify({
            status: "success",
            associationErrors: [{ bundleId: "pattern:state:open-loop" }],
            dominanceWarnings: ["compaction-promoted exceeded candidate quota"],
          }),
          stderr: "",
        };
      },
    });

    assert.equal(report.status, "passed_with_warnings");
    assert.equal(report.summary.warning, 1);
    assert.equal(report.jobs[0].status, "warning");
    assert.deepEqual(report.jobs[0].warnings, ["1 association scout error(s)"]);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});

test("runIdleWorker surfaces nested wiki payload warnings from guarded jobs", async () => {
  const runRoot = tempRunRoot();
  try {
    const options = parseArgs([
      "--jobs",
      "wiki",
      "--skip-load-check",
      "--run-id",
      "wiki-warning-test",
      "--run-root",
      runRoot,
      "--artifact",
      join(runRoot, "latest.json"),
      "--lock-path",
      join(runRoot, "lock.json"),
    ]);

    const report = await runIdleWorker(options, {
      runner(_program, args) {
        const command = args.join(" ");
        const nested =
          command.includes("wiki:contradictions:scan")
            ? {
                schema: "wiki-contradiction-scan.v1",
                status: "warning",
                summary: { contradictions: 2, hard: 2, critical: 0 },
              }
            : {
                schema: "wiki-source-index.v1",
                status: "planned",
                summary: { indexed: 1, denied: 0, chunks: 1 },
              };
        return {
          status: 0,
          stdout: JSON.stringify({
            schema: "repo-audit-branch-guard-v1",
            status: "pass",
            command: {
              stdoutTail: `> npm header\n${JSON.stringify(nested, null, 2)}\n`,
            },
            violations: [],
          }),
          stderr: "",
        };
      },
    });

    const contradictionJob = report.jobs.find((job) => job.id === "wiki-contradiction-scan");
    assert.equal(report.status, "passed_with_warnings");
    assert.equal(report.summary.warning, 1);
    assert.equal(contradictionJob.status, "warning");
    assert.deepEqual(contradictionJob.warnings, ["payload status: warning"]);
    assert.equal(contradictionJob.payloadSummary.schema, "wiki-contradiction-scan.v1");
    assert.equal(contradictionJob.payloadSummary.guardStatus, "pass");
    assert.match(contradictionJob.payloadSummary.summary, /"contradictions":2/);
  } finally {
    rmSync(runRoot, { recursive: true, force: true });
  }
});
