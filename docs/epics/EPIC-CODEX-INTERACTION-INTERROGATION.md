# EPIC: CODEX-INTERACTION-INTERROGATION

Status: Active  
Owner: Platform / DevEx  
Created: 2026-02-26

## Mission

Continuously interrogate recent interaction patterns (Codex + human collaboration) and apply structural improvements to `.codex/user.md` and `.codex/agents.md` that reduce ambiguity, friction loops, and workflow drift.

## Non-Goals

- Personality rewriting
- Cosmetic wording churn
- High-frequency micro-edits without structural impact

## Cadence (Phoenix Time)

- 06:40 AM America/Phoenix (MST year-round)
- 03:40 PM America/Phoenix (MST year-round)
- Primary window: last 12h
- Secondary rollup: last 24h

## Signals

- Git commit messages
- PR comments and review discussions
- Issues opened/closed
- Reverts
- Clarification loop patterns
- File churn hotspots
- Automation-created tickets/PR metadata
- Tool-call retry/confusion clusters
- Metadata/workflow edits linked to misunderstanding

## Trigger Thresholds

Automation proposes structural updates only when at least one threshold is crossed:

- Same misunderstanding pattern appears >= 2 times in 24h
- Clarification loop exceeds 3 back-and-forth comments
- Same workflow rule is restated multiple times
- Repeated structurally-similar automation misinterpretation
- Repeated tool misuse cluster

## Improvement Targets

- `.codex/user.md`
  - expectation clarity
  - constraints + scope boundaries
  - output format non-negotiables
- `.codex/agents.md`
  - role guardrails
  - ask-vs-decide decision policy
  - tool usage + retry boundaries
  - branch protection + delivery behavior

## Safety Guardrails

- PR-only automation, never direct push to `main`
- If structural edits are deferred by policy state (for example cooldown/duplicate-run/workflow signal), report the exact blocker and the minimal unblock action before any broader retry.
- At most one interaction-improvement PR per run ID
- Existing run PR must be updated, not duplicated
- Shared state with continuous-improvement loop via `.codex/improvement-state.json`
- Never open more than one automation PR per run across enabled loops
- Loop prevention:
  - ignore `.codex/user.md`, `.codex/agents.md`, and this epic file in churn detection
  - skip already-processed run IDs
  - ignore automation-labeled PRs in interaction signal analysis
- Retry rule:
  - After 2+ identical automation/tooling failures, classify failure type and switch strategy before rerun.
  - For `runtime_error` failures from branch switching or dirty worktree, require a documented reconciliation step (`git status`, worktree cleanup, branch target validation) before retry.
- If `codex:interaction:apply` returns `structuralDecision.mode: Deferred` (or equivalent signal-only output), record a blocker-style entry and defer structural edits until a future AM/PM window unless an explicit emergency override is set.
- Structural cadence:
  - Minimum 24h between structural instruction doc edits unless manual emergency override is justified and logged.
  - If a run is gated by cooldown, it must still produce a log record and a concrete unblock step for the next AM/PM run.
- Blocker handling standard:
  - For `skip`/`duplicate`/`cooldown` statuses, log one blocked-state entry with the command+signature and exact block reason before any next step.
  - For startup continuity failures (for example `missing-auth-token`, timeout, or transport error), log one `startup-blocked` entry with:
    - `command`
    - `runId`
    - `query`
    - `attempted-tool`
    - `error-code`
  - If startup recovery returns no context rows, record a `startup-no-context` block with the same fields and `payload-empty=true`, then continue only with explicitly scoped task commands.
  - Do only one unblock action before rerunning:
    - change `--run-id`,
    - switch AM/PM slot by scheduling the next cadence, or
    - explicitly shift scope/task intent.
  - Retry startup continuity only after one unblock action:
    - use the task-specific `query` + `runId`, `expandRelationships: true`, `maxHops: 3`.

## Required Outputs

- Append run record to `.codex/interaction-log.md`
- Update rolling issue: `Codex Interaction Interrogation (Rolling)`
- Record structured blocker entries for deferred or duplicate signals (command, signature, reason, unblock step).
- When triggered, open/update PR from:
  - `codex/interaction-improve/YYYY-MM-DD-AM`
  - `codex/interaction-improve/YYYY-MM-DD-PM`

## Acceptance Criteria

- Twice-daily workflow executes on Phoenix-equivalent UTC cron
- Threshold-driven batching prevents cosmetic churn
- Structural improvements are auditable and evidence-based
- PR body includes analysis, before/after, risk assessment, and QA guidance
- Branch protection expectations are preserved in all automation paths
