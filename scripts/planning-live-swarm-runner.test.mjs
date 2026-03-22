import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPlanningGovernance } from "./lib/planning-control-plane.mjs";
import { buildCodexExecArgs, buildCritiquePrompt, buildPlannerRevisionPrompt } from "./lib/planning-live-swarm-runner.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

function getRole(roleId) {
  const governance = loadPlanningGovernance(REPO_ROOT);
  return governance.curatedRoleManifests.roles.find((role) => role.roleId === roleId);
}

test("critique prompt includes role instructions, evidence standards, merge rules, and memory refs", () => {
  const role = getRole("security-reviewer.v1");
  const prompt = buildCritiquePrompt({
    role,
    cycle: 1,
    draftMarkdown: "# Upgraded Council Plan\n\n## Validation Gates\n- Add explicit signoff.\n",
    sharedRefs: [{ refId: "mem-1", kind: "memory-pack-item", label: "Prior packet", summary: "Earlier packet required explicit security signoff." }],
    roleRefs: [{ refId: "mem-2", kind: "prior-role-note", label: "Security note", summary: "Security review blocked implicit trust-boundary changes." }],
    priorFindings: [{ findingId: "finding-1", affectedPlanSection: "Validation Gates", claim: "Add an explicit signoff gate.", severity: "high", status: "open" }],
  });

  assert.match(prompt, /Flag auth, privilege, secret, and untrusted-input issues early/i);
  assert.match(prompt, /tie claims to affected trust boundary/i);
  assert.match(prompt, /Never clear a security blocker without an explicit gate/i);
  assert.match(prompt, /\[mem-1\]/);
  assert.match(prompt, /\[mem-2\]/);
});

test("planner revision prompt carries findings and prior address outcomes into the planner pass", () => {
  const role = getRole("lead-planner.v1");
  const prompt = buildPlannerRevisionPrompt({
    role,
    cycle: 2,
    draftMarkdown: "# Upgraded Council Plan\n\n## Summary\n- Keep the first slice staff-only.\n",
    findings: [{ findingId: "finding-7", affectedPlanSection: "Ordered Execution Sequence", claim: "Add a narrower validation checkpoint.", severity: "high", status: "open" }],
    sharedRefs: [],
    roleRefs: [],
    previousAddressMatrix: [{ findingId: "finding-3", status: "unresolved", reason: "Human decision still needed." }],
  });

  assert.match(prompt, /Every supplied finding must appear once in addresses/i);
  assert.match(prompt, /finding-7/);
  assert.match(prompt, /finding-3: unresolved/i);
  assert.match(prompt, /Preserve the canonical section headings/i);
});

test("codex exec args use ephemeral read-only execution with stdin prompt input", () => {
  const args = buildCodexExecArgs({
    executionRoot: "C:/Windows/Temp",
    model: "gpt-5.4",
    outputPath: resolve(REPO_ROOT, "tmp", "last-message.txt"),
    reasoningEffort: "low",
  });

  assert.deepEqual(args.slice(0, 19), [
    "exec",
    "--skip-git-repo-check",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "--disable",
    "apps",
    "--disable",
    "multi_agent",
    "--disable",
    "shell_snapshot",
    "-c",
    "model_reasoning_effort=\"low\"",
    "-c",
    "web_search=\"disabled\"",
    "-c",
    "mcp_servers.open_memory.enabled=false",
  ]);
  assert.deepEqual(args.slice(19, 23), [
    "-C",
    resolve("C:/Windows/Temp"),
    "-m",
    "gpt-5.4",
  ]);
  assert.equal(args.at(-1), "-");
  assert.ok(args.includes("-m"));
  assert.ok(args.includes("-o"));
});
