import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT_PATH = resolve("scripts", "agent-file-plan-apply.mjs");

test("agent file plan apply updates files from a file-backed plan", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agent-file-plan-"));
  try {
    mkdirSync(join(repoRoot, "scripts"), { recursive: true });
    writeFileSync(join(repoRoot, "scripts", "agent-file-plan-apply.mjs"), readFileSync(SCRIPT_PATH, "utf8"), "utf8");
    writeFileSync(join(repoRoot, "target.txt"), "alpha\nbeta\n", "utf8");
    writeFileSync(
      join(repoRoot, "plan.json"),
      JSON.stringify(
        {
          schema: "agent-file-plan.v1",
          operations: [
            {
              type: "replace",
              path: "target.txt",
              find: "beta",
              replace: "gamma",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync(process.execPath, ["./scripts/agent-file-plan-apply.mjs", "--plan", "plan.json", "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    assert.equal(result.status, 0);
    assert.match(result.stdout, /"appliedCount": 1/);
    assert.equal(readFileSync(join(repoRoot, "target.txt"), "utf8"), "alpha\ngamma\n");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("agent file plan apply can dry-run without mutating files", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "agent-file-plan-dry-"));
  try {
    mkdirSync(join(repoRoot, "scripts"), { recursive: true });
    writeFileSync(join(repoRoot, "scripts", "agent-file-plan-apply.mjs"), readFileSync(SCRIPT_PATH, "utf8"), "utf8");
    writeFileSync(join(repoRoot, "target.txt"), "alpha\n", "utf8");
    writeFileSync(
      join(repoRoot, "plan.json"),
      JSON.stringify(
        {
          schema: "agent-file-plan.v1",
          operations: [
            {
              type: "append",
              path: "target.txt",
              content: "beta\n",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = spawnSync(
      process.execPath,
      ["./scripts/agent-file-plan-apply.mjs", "--plan", "plan.json", "--dry-run", "--json"],
      {
        cwd: repoRoot,
        encoding: "utf8",
      },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /"plannedCount": 1/);
    assert.equal(readFileSync(join(repoRoot, "target.txt"), "utf8"), "alpha\n");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
