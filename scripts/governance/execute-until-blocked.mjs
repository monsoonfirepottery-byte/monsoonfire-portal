#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");

function parseRepoSlug(input) {
  const raw = String(input || "").trim();
  if (!raw) return { owner: "", repo: "" };
  const normalized = raw
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^git@github\.com:/i, "")
    .replace(/\.git$/i, "")
    .replace(/^\/+/, "")
    .trim();
  if (!normalized) return { owner: "", repo: "" };
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length >= 2) return { owner: parts[0], repo: parts[1] };
  return { owner: "", repo: parts[0] || "" };
}

function inferFromGitConfig() {
  try {
    const configPath = resolve(REPO_ROOT, ".git", "config");
    const config = readFileSync(configPath, "utf8");
    const remoteOriginBlock = config.match(/\[remote "origin"\]([\s\S]*?)(\n\[|$)/);
    const remoteBlock = remoteOriginBlock ? remoteOriginBlock[1] : "";
    const urlMatch = remoteBlock.match(/^\s*url\s*=\s*(.+)\s*$/m);
    if (!urlMatch) return { owner: "", repo: "" };
    return parseRepoSlug(urlMatch[1]);
  } catch {
    return { owner: "", repo: "" };
  }
}

function resolveToken() {
  const envToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  if (envToken) return envToken;
  try {
    return execFileSync("gh", ["auth", "token"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const repoEnvParts = parseRepoSlug(process.env.GITHUB_REPOSITORY || "");
  const defaults = inferFromGitConfig();
  const parsed = {
    owner: process.env.GITHUB_REPOSITORY_OWNER || repoEnvParts.owner || defaults.owner || "",
    repo: repoEnvParts.repo || defaults.repo || "",
    output: "output/governance/execute-until-blocked.json",
    dispatch: true
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i] || "");
    if (arg === "--owner" && argv[i + 1]) {
      parsed.owner = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--repo" && argv[i + 1]) {
      parsed.repo = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if ((arg === "--output" || arg === "--report") && argv[i + 1]) {
      parsed.output = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--dispatch" && argv[i + 1]) {
      parsed.dispatch = String(argv[i + 1]).toLowerCase() !== "false";
      i += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Execute governance recommendations until blocked",
          "",
          "Usage:",
          "  node ./scripts/governance/execute-until-blocked.mjs [options]",
          "",
          "Options:",
          "  --owner <org>         GitHub org/user (auto-detected when omitted)",
          "  --repo <name>         GitHub repo name (auto-detected when omitted)",
          "  --output <path>       Output status JSON path",
          "  --dispatch <bool>     Try remote workflow dispatch (default: true)"
        ].join("\n")
      );
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function runStep(name, command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const child = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...(options.env || {}) }
  });
  const endedAt = new Date().toISOString();
  const stdout = String(child.stdout || "").trim();
  const stderr = String(child.stderr || "").trim();
  const status = Number.isInteger(child.status) ? child.status : 1;
  const okExitCodes = Array.isArray(options.okExitCodes) ? options.okExitCodes : [0];
  return {
    name,
    command: [command, ...args].join(" "),
    status: okExitCodes.includes(status) ? "ok" : "failed",
    exit_code: status,
    started_at: startedAt,
    ended_at: endedAt,
    stdout: stdout.length > 0 ? stdout : null,
    stderr: stderr.length > 0 ? stderr : null
  };
}

function parseLatestPrNumber(repoSlug) {
  const raw = execFileSync(
    "gh",
    ["pr", "list", "--repo", repoSlug, "--limit", "1", "--json", "number", "--jq", ".[0].number"],
    { cwd: REPO_ROOT, encoding: "utf8" }
  )
    .trim()
    .replace(/[^\d]/g, "");
  const number = Number(raw);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`Could not resolve latest PR number from: ${raw}`);
  }
  return number;
}

function checkWorkflowExists(repoSlug, workflowPath) {
  try {
    const raw = execFileSync("gh", ["api", `repos/${repoSlug}/actions/workflows`], {
      cwd: REPO_ROOT,
      encoding: "utf8"
    });
    const payload = JSON.parse(raw);
    const workflows = Array.isArray(payload.workflows) ? payload.workflows : [];
    return workflows.some((wf) => String(wf.path || "").endsWith(workflowPath));
  } catch {
    return false;
  }
}

function writeJsonFile(pathValue, value) {
  const absolute = resolve(REPO_ROOT, pathValue);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runStartedAt = new Date().toISOString();
  const token = resolveToken();
  const repoSlug = `${args.owner}/${args.repo}`;
  const steps = [];
  let blocked = null;
  const recommendedActions = [];

  if (!args.owner || !args.repo) {
    blocked = {
      reason: "repository_unresolved",
      detail: "Could not resolve GitHub owner/repo from args, env, or origin remote."
    };
    recommendedActions.push("Set --owner and --repo explicitly for governance execution.");
  } else if (!token) {
    blocked = {
      reason: "missing_auth_token",
      detail: "No GitHub token found. Set GITHUB_TOKEN/GH_TOKEN or run gh auth login."
    };
    recommendedActions.push("Run gh auth login (or export GITHUB_TOKEN) and retry.");
  }

  if (!blocked) {
    steps.push(runStep("governance_validate", "node", ["./scripts/governance/validate-governance-artifacts.mjs", "--report", "output/governance/validate-governance-artifacts.json"]));
    if (steps.at(-1).status !== "ok") {
      blocked = { reason: "governance_validate_failed", detail: "Validation failed." };
      recommendedActions.push("Fix governance validation errors shown in step output and retry.");
    }
  }

  if (!blocked) {
    steps.push(
      runStep("governance_weekly_tune", "node", ["./scripts/governance/weekly-tune-thresholds.mjs", "--owner", args.owner, "--repo", args.repo, "--output", "output/governance/weekly-tune-report.json"], {
        env: { GITHUB_TOKEN: token }
      })
    );
    if (steps.at(-1).status !== "ok") {
      blocked = { reason: "governance_weekly_tune_failed", detail: "Weekly tuning script failed." };
      recommendedActions.push("Confirm GitHub API access and tuning script inputs, then retry.");
    }
  }

  let prNumber = null;
  let eventPath = "";
  if (!blocked) {
    try {
      prNumber = parseLatestPrNumber(repoSlug);
      eventPath = join(tmpdir(), `governance-event-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
      writeFileSync(
        eventPath,
        JSON.stringify({
          pull_request: { number: prNumber },
          repository: { owner: { login: args.owner }, name: args.repo }
        }),
        "utf8"
      );
      steps.push(
        runStep(
          "governance_supervisor_local_audit",
          "node",
          [
            "./scripts/governance/supervisor-audit.mjs",
            "--event-path",
            eventPath,
            "--output-json",
            "output/governance/supervisor-audit-local.json",
            "--output-md",
            "output/governance/supervisor-audit-local.md"
          ],
          { env: { GITHUB_TOKEN: token, GITHUB_REPOSITORY: repoSlug } }
        )
      );
      if (steps.at(-1).status !== "ok") {
        blocked = { reason: "governance_supervisor_local_audit_failed", detail: "Supervisor audit script failed." };
        recommendedActions.push("Inspect local supervisor audit output and fix script/config errors.");
      }
    } catch (error) {
      blocked = {
        reason: "latest_pr_resolution_failed",
        detail: error instanceof Error ? error.message : String(error)
      };
      recommendedActions.push("Ensure at least one PR is available and GitHub CLI can query it.");
    }
  }

  if (!blocked && args.dispatch) {
    const weeklyWorkflowPath = ".github/workflows/governance-weekly-tuning.yml";
    const syncReportPath = "output/governance/remote-workflow-sync-check.json";
    steps.push(
      runStep(
        "governance_remote_workflow_sync_check",
        "node",
        [
          "./scripts/governance/remote-workflow-sync-check.mjs",
          "--owner",
          args.owner,
          "--repo",
          args.repo,
          "--output",
          syncReportPath,
          "--open-issue",
          "true"
        ],
        {
          env: { GITHUB_TOKEN: token },
          okExitCodes: [0, 2]
        }
      )
    );
    const syncStep = steps.at(-1);
    if (syncStep.exit_code === 2) {
      let issueUrl = "";
      steps.push(
        runStep(
          "governance_remote_workflow_sync_apply",
          "node",
          [
            "./scripts/governance/remote-workflow-sync-apply.mjs",
            "--owner",
            args.owner,
            "--repo",
            args.repo,
            "--output",
            "output/governance/remote-workflow-sync-apply.json",
            "--close-issue",
            "true"
          ],
          {
            env: { GITHUB_TOKEN: token },
            okExitCodes: [0, 2, 3]
          }
        )
      );
      const applyStep = steps.at(-1);
      if (applyStep.exit_code === 0) {
        steps.push(
          runStep(
            "governance_remote_workflow_sync_recheck",
            "node",
            [
              "./scripts/governance/remote-workflow-sync-check.mjs",
              "--owner",
              args.owner,
              "--repo",
              args.repo,
              "--output",
              "output/governance/remote-workflow-sync-check.json",
              "--open-issue",
              "true"
            ],
            {
              env: { GITHUB_TOKEN: token },
              okExitCodes: [0, 2]
            }
          )
        );
        const recheck = steps.at(-1);
        if (recheck.exit_code === 0) {
          const hasWeeklyWorkflow = checkWorkflowExists(repoSlug, weeklyWorkflowPath);
          if (hasWeeklyWorkflow) {
            steps.push(runStep("governance_weekly_dispatch", "gh", ["workflow", "run", "governance-weekly-tuning.yml", "--repo", repoSlug]));
            if (steps.at(-1).status !== "ok") {
              blocked = {
                reason: "governance_weekly_dispatch_failed",
                detail: "Remote workflow dispatch failed after sync apply."
              };
              recommendedActions.push("Check repository workflow permissions and dispatch command output.");
            }
          } else {
            blocked = {
              reason: "weekly_workflow_index_delay",
              detail: `${weeklyWorkflowPath} has been pushed but is not yet indexed by GitHub Actions.`
            };
            recommendedActions.push("Wait briefly for GitHub workflow indexing, then re-run execute-until-blocked.");
          }
        } else {
          blocked = {
            reason: "remote_workflow_sync_recheck_failed",
            detail: "Remote workflow sync recheck did not confirm a synced state."
          };
          recommendedActions.push("Inspect remote workflow sync reports and rerun sync apply.");
        }
      } else if (applyStep.exit_code === 3) {
        let fallbackPrUrl = "";
        try {
          const applyReport = JSON.parse(readFileSync(resolve(REPO_ROOT, "output/governance/remote-workflow-sync-apply.json"), "utf8"));
          fallbackPrUrl = String(applyReport?.fallback_pr?.url || "");
        } catch {
          fallbackPrUrl = "";
        }
        blocked = {
          reason: "remote_workflow_sync_pr_open",
          detail: fallbackPrUrl
            ? `Fallback workflow sync PR opened and awaiting merge: ${fallbackPrUrl}`
            : "Fallback workflow sync PR opened and awaiting merge."
        };
        recommendedActions.push("Merge the fallback workflow sync PR.");
        recommendedActions.push("After merge, re-run governance:execute:until-blocked.");
      } else {
        if (applyStep.status !== "ok") {
          blocked = {
            reason: "remote_workflow_sync_apply_failed",
            detail: "Attempt to sync governance workflows to remote failed."
          };
          recommendedActions.push("Inspect remote-workflow-sync-apply report for permission/path failures.");
          recommendedActions.push("Grant repository contents:write access for sync token and retry.");
        } else {
          blocked = {
            reason: "remote_workflow_sync_apply_incomplete",
            detail: "Sync apply completed but workflows are still missing."
          };
          recommendedActions.push("Inspect failed paths in sync apply report and retry.");
        }
      }
      if (blocked) {
        try {
          const syncReport = JSON.parse(readFileSync(resolve(REPO_ROOT, syncReportPath), "utf8"));
          issueUrl = String(syncReport?.issue?.url || "");
        } catch {
          issueUrl = "";
        }
      }
      if (blocked && issueUrl && !blocked.detail.includes(issueUrl)) {
        blocked.detail = `${blocked.detail} Sync issue: ${issueUrl}`;
      }
      if (blocked) {
        recommendedActions.push("Re-run governance:remote:sync:check until synced=true.");
        recommendedActions.push("Re-run governance:execute:until-blocked to continue dispatch.");
      }
    } else if (syncStep.status !== "ok") {
      blocked = {
        reason: "remote_workflow_sync_check_failed",
        detail: "Remote workflow sync check failed."
      };
      recommendedActions.push("Verify GitHub auth/connectivity and rerun remote sync check.");
    } else {
      const hasWeeklyWorkflow = checkWorkflowExists(repoSlug, weeklyWorkflowPath);
      if (!hasWeeklyWorkflow) {
        blocked = {
          reason: "weekly_workflow_missing_on_remote",
          detail: `${weeklyWorkflowPath} is not available in remote GitHub workflow registry.`
        };
        recommendedActions.push("Push weekly workflow file and wait for GitHub workflow index refresh.");
      } else {
        steps.push(runStep("governance_weekly_dispatch", "gh", ["workflow", "run", "governance-weekly-tuning.yml", "--repo", repoSlug]));
        if (steps.at(-1).status !== "ok") {
          blocked = {
            reason: "governance_weekly_dispatch_failed",
            detail: "Remote workflow dispatch failed."
          };
          recommendedActions.push("Check repository workflow permissions and dispatch command output.");
        }
      }
    }
  }

  const runEndedAt = new Date().toISOString();
  const report = {
    run_started_at: runStartedAt,
    run_ended_at: runEndedAt,
    repository: args.owner && args.repo ? `${args.owner}/${args.repo}` : null,
    pr_number: prNumber,
    dispatch_enabled: args.dispatch,
    blocked,
    recommended_actions: recommendedActions,
    steps
  };

  writeJsonFile(args.output, report);

  if (blocked) {
    process.stdout.write(`governance-execute blocked: ${blocked.reason}\n`);
    process.stdout.write(`detail: ${blocked.detail}\n`);
    process.stdout.write(`report: ${args.output}\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write("governance-execute completed without blockers.\n");
  process.stdout.write(`report: ${args.output}\n`);
}

main().catch((error) => {
  process.stderr.write(`governance-execute failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
