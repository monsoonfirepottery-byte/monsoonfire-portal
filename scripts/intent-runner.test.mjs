import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function createFixturePlan({
  digest = "digest-v1",
  tasks = [
    {
      taskId: "intent-a::task-1",
      intentId: "intent-a",
      dependsOn: [],
      checks: ['node -e "process.exit(0)"'],
    },
  ],
} = {}) {
  return {
    schema: "intent-plan.v1",
    generatedAt: "2026-03-03T00:00:00.000Z",
    planDigestSha256: digest,
    intentCount: 1,
    taskCount: tasks.length,
    intents: [
      {
        intentId: "intent-a",
        epicPath: "docs/epics/EPIC-PLACEHOLDER.md",
        riskTier: "low",
      },
    ],
    tasks,
  };
}

function runIntentRunner(args) {
  return spawnSync("node", ["./scripts/intent-runner.mjs", "--json", ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
}

function parseJsonStdout(stdoutText) {
  const text = String(stdoutText || "").trim();
  return JSON.parse(text);
}

test("intent-runner plan mode orders selected task with dependencies", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "intent-runner-test-"));
  try {
    const planPath = join(tempDir, "plan.json");
    const reportPath = join(tempDir, "report.json");
    const ledgerPath = join(tempDir, "ledger.jsonl");

    const plan = createFixturePlan({
      tasks: [
        {
          taskId: "intent-a::task-1",
          intentId: "intent-a",
          dependsOn: [],
          checks: ['node -e "process.exit(0)"'],
        },
        {
          taskId: "intent-a::task-2",
          intentId: "intent-a",
          dependsOn: ["intent-a::task-1"],
          checks: ['node -e "process.exit(0)"'],
        },
      ],
    });
    writeFileSync(planPath, JSON.stringify(plan, null, 2));

    const result = runIntentRunner(["--plan", planPath, "--task", "intent-a::task-2", "--report", reportPath, "--ledger", ledgerPath]);
    assert.equal(result.status, 0, result.stderr || "expected plan mode to succeed");

    const report = parseJsonStdout(result.stdout);
    assert.equal(report.status, "pass");
    assert.equal(report.mode, "plan");
    assert.equal(report.orderedTaskCount, 2);
    assert.equal(report.summary.planned, 2);
    assert.deepEqual(
      report.tasks.map((row) => row.taskId),
      ["intent-a::task-1", "intent-a::task-2"]
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("intent-runner execute mode marks dependent tasks as blocked with continue-on-error", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "intent-runner-test-"));
  try {
    const planPath = join(tempDir, "plan.json");
    const reportPath = join(tempDir, "report.json");
    const ledgerPath = join(tempDir, "ledger.jsonl");

    const plan = createFixturePlan({
      tasks: [
        {
          taskId: "intent-a::task-fail",
          intentId: "intent-a",
          dependsOn: [],
          checks: ['node -e "process.exit(1)"'],
        },
        {
          taskId: "intent-a::task-dependent",
          intentId: "intent-a",
          dependsOn: ["intent-a::task-fail"],
          checks: ['node -e "process.exit(0)"'],
        },
        {
          taskId: "intent-a::task-independent",
          intentId: "intent-a",
          dependsOn: [],
          checks: ['node -e "process.exit(0)"'],
        },
      ],
    });
    writeFileSync(planPath, JSON.stringify(plan, null, 2));

    const result = runIntentRunner([
      "--execute",
      "--continue-on-error",
      "--plan",
      planPath,
      "--report",
      reportPath,
      "--ledger",
      ledgerPath,
      "--run-id",
      "intent-runner-test-exec",
    ]);

    assert.equal(result.status, 1, "execute mode should return non-zero when failures occur");

    const report = parseJsonStdout(result.stdout);
    assert.equal(report.status, "fail");
    assert.equal(report.summary.failed, 1);
    assert.equal(report.summary.blocked, 1);
    assert.equal(report.summary.succeeded, 1);

    const byTaskId = new Map(report.tasks.map((row) => [row.taskId, row]));
    assert.equal(byTaskId.get("intent-a::task-fail").status, "failed");
    assert.equal(byTaskId.get("intent-a::task-dependent").status, "blocked");
    assert.equal(byTaskId.get("intent-a::task-independent").status, "succeeded");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("intent-runner resume skips already succeeded tasks for same run-id", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "intent-runner-test-"));
  try {
    const planPath = join(tempDir, "plan.json");
    const reportPath = join(tempDir, "report.json");
    const resumeReportPath = join(tempDir, "report.resume.json");
    const ledgerPath = join(tempDir, "ledger.jsonl");
    const runId = "intent-runner-test-resume";

    const plan = createFixturePlan({
      tasks: [
        {
          taskId: "intent-a::task-1",
          intentId: "intent-a",
          dependsOn: [],
          checks: ['node -e "process.exit(0)"'],
        },
      ],
    });
    writeFileSync(planPath, JSON.stringify(plan, null, 2));

    const firstRun = runIntentRunner([
      "--execute",
      "--plan",
      planPath,
      "--report",
      reportPath,
      "--ledger",
      ledgerPath,
      "--run-id",
      runId,
    ]);
    assert.equal(firstRun.status, 0, firstRun.stderr || "initial execute run should pass");

    const resumedRun = runIntentRunner([
      "--execute",
      "--resume",
      "--plan",
      planPath,
      "--report",
      resumeReportPath,
      "--ledger",
      ledgerPath,
      "--run-id",
      runId,
    ]);
    assert.equal(resumedRun.status, 0, resumedRun.stderr || "resume run should pass");

    const report = parseJsonStdout(resumedRun.stdout);
    assert.equal(report.status, "pass");
    assert.equal(report.summary.succeededResume, 1);
    assert.equal(report.tasks[0].status, "succeeded_resume");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("intent-runner resume fails on plan digest mismatch", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "intent-runner-test-"));
  try {
    const planPath = join(tempDir, "plan.json");
    const reportPath = join(tempDir, "report.json");
    const ledgerPath = join(tempDir, "ledger.jsonl");
    const runId = "intent-runner-test-digest-mismatch";

    const originalPlan = createFixturePlan({
      digest: "digest-v1",
    });
    writeFileSync(planPath, JSON.stringify(originalPlan, null, 2));

    const firstRun = runIntentRunner([
      "--execute",
      "--plan",
      planPath,
      "--report",
      reportPath,
      "--ledger",
      ledgerPath,
      "--run-id",
      runId,
    ]);
    assert.equal(firstRun.status, 0, firstRun.stderr || "initial execute run should pass");

    const changedPlan = createFixturePlan({
      digest: "digest-v2",
    });
    writeFileSync(planPath, JSON.stringify(changedPlan, null, 2));

    const resumedRun = runIntentRunner([
      "--execute",
      "--resume",
      "--plan",
      planPath,
      "--report",
      reportPath,
      "--ledger",
      ledgerPath,
      "--run-id",
      runId,
    ]);

    assert.equal(resumedRun.status, 1, "resume should fail when digest changed");
    assert.match(String(resumedRun.stderr || ""), /Plan digest mismatch/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("intent-runner writes ledger events to configured path", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "intent-runner-test-"));
  try {
    const planPath = join(tempDir, "plan.json");
    const reportPath = join(tempDir, "report.json");
    const ledgerDir = join(tempDir, "nested", "ledger");
    const ledgerPath = join(ledgerDir, "events.jsonl");
    const runId = "intent-runner-test-ledger";

    mkdirSync(ledgerDir, { recursive: true });
    writeFileSync(planPath, JSON.stringify(createFixturePlan(), null, 2));

    const result = runIntentRunner([
      "--plan",
      planPath,
      "--report",
      reportPath,
      "--ledger",
      ledgerPath,
      "--run-id",
      runId,
    ]);
    assert.equal(result.status, 0, result.stderr || "plan run should pass");

    const ledgerLines = readFileSync(ledgerPath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));

    assert.ok(ledgerLines.length >= 3, "expected run + task ledger events");
    assert.equal(ledgerLines[0].eventType, "run_started");
    assert.equal(ledgerLines.at(-1).eventType, "run_finished");
    assert.ok(ledgerLines.every((event) => event.runId === runId));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
