# Codex User Interaction Contract

## Prompt Shape (Required)

- Include `Objective` in one sentence.
- Include explicit `Constraints` (security, branch policy, environment limits).
- Include `Non-goals` to prevent scope creep.
- Include `Definition of Done` with observable checks.

## Scope Boundary Rules

- Prefer targeted requests over broad rewrites.
- Explicitly list pages/services in scope.
- Call out excluded files or systems when needed.

## Non-Negotiables

- No direct push to `main`.
- No secrets in prompts, logs, or payload examples.
- Production safety takes priority over speed when risk is unclear.
- Guardrails and contracts outrank stylistic preferences.

## Preferred Output Contract

- Short status of what changed.
- Files touched.
- Behavior impact and risk callout.
- Copyable QA checklist when behavior changed.

<!-- codex-interaction:auto:start -->
### Automated Structural Addenda

- Last structural update: 2026-03-11-AM
- Active rules:
- [USER_BRANCH_POLICY] Include branch policy in scope constraints: PR-only changes, never direct push to `main`.
- [USER_OUTPUT_CONTRACT] Require output sections for behavior change summary, risk assessment, and copyable QA checks.
- [USER_PROMPT_STRUCTURE] Require `Objective`, `Constraints`, `Non-goals`, and `Definition of Done` in implementation prompts.
- [USER_SCOPE_FENCE] Explicitly list in-scope and out-of-scope surfaces to prevent scope creep.
- [USER_STARTUP_BLOCK_EVIDENCE_EXTENDED] For startup continuity misses in codex-docs-only runs, capture complete blocker evidence before any retry (`command`, `signature`, `runId`, `query`, `attempted-tool`, `exit status`, `first signal`) and execute one unblock action first.
- [USER_STARTUP_CONTEXT_BOUNDING] If startup continuity lookup fails with unchanged `(query + runId)` and is not due to normal retry noise, classify as startup-blocked immediately, log blocker evidence (`command`, `runId`, `query`), take one unblock action (`--run-id` shift or AM/PM defer), then retry context check once.
- [USER_STARTUP_CONTEXT_TOOLING] For startup continuity misses (`missing-auth`, `401`, `status 0`) in code docs runs, log signal + blocker evidence in-order, run `startup_memory_context` once with explicit task query, same `runId`, `expandRelationships: true`, `maxHops: 3`, and only then resume with one unblock action before any broader rerun.
- [USER_STARTUP_BLOCK_BUDGET] For unchanged startup misses in docs-only runs, stop interaction retries after the first hard-block signal (`missing-auth-token`, HTTP 401, status 0), log blocker evidence (`command`, `runId`, `query`, `first signal`), then perform exactly one unblock action (`--run-id` shift, AM/PM defer, or auth recovery) before any single-context rerun.
- [USER_DOCS_HEALTH_GATES] For `writeScope: codex-docs-only`, complete with both strict checks passing: `npm run codex:docs:drift:strict` and `npm run codex:doctor:strict`; on first failure, capture command + first failure signal and take one unblock action before retrying.
- [USER_INTERACTION_DEFERRED_MODE] If `codex:interaction:apply` returns `structuralDecision.mode: Deferred` (for example because a focused PR or rolling issue already exists), log a blocker-style evidence entry and defer structural instruction edits to the next AM/PM cadence unless a manual emergency override is explicitly set.
- [USER_INTERACTION_PARKING_PROTOCOL] When `codex:interaction:apply` reports an existing open rolling issue/PR lock, classify run state as parking, record `command`, `runId`, and `reason`, then execute only one unblock action (run-id shift or next slot) before rerunning.
- [USER_INTERACTION_NOOP] If structural analysis resolves to `Deferred` with no new rule candidates, treat this as a structured no-op; log `command`, `runId`, and `reason`, then run at most one unblock action before any retrial.
- [USER_DOCS_SCOPE_EXPLICITITY] In `writeScope: codex-docs-only`, enumerate and constrain in-scope files up front (default: `.codex/*.md` and codex interaction runbooks only), then list excluded surfaces explicitly in the task plan.
- [USER_APPLY_WORKTREE_RECOVERY] When `codex:interaction:apply` fails with `dirty worktree` refusal, log blocker evidence (`command`, `runId`, `signal`) and take exactly one unblock action (`git status`/commit/stash cleanup, or rerun once with `--allow-dirty`) before any broader retry.
<!-- codex-interaction:auto:end -->
