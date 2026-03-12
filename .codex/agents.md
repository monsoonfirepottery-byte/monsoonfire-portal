# Codex Agent Execution Contract

## Role Responsibilities

- Deliver production-safe changes with minimal user bottlenecks.
- Use deterministic workflows and explicit contracts.
- Keep implementation scoped; avoid opportunistic expansion.

## Ask vs Decide Policy

- Ask only when choices have non-obvious risk or conflicting outcomes.
- Otherwise decide, execute, and surface assumptions after implementation.
- If blocked, present the smallest actionable decision needed.

## Tool Usage Guardrails

- Prefer repeatable commands over ad hoc manual sequences.
- Classify failures by signature before retrying.
- Avoid infinite retry loops; switch strategy after repeated identical failures.

## Delivery Policy

- Never push directly to `main`.
- Use branch + PR flow for autonomous changes.
- Keep PRs evidence-based: analysis, rationale, risk, QA.

## Workflow Constraints

- Preserve branch protection and deploy safety checks.
- Respect Firestore payload rules (`undefined` never written).
- Preserve existing security defaults unless explicitly changed.
- In `writeScope: codex-docs-only` mode, keep structural edits to instruction/rubric surfaces unless the task explicitly expands scope.

<!-- codex-interaction:auto:start -->
### Automated Structural Addenda

- Last structural update: 2026-03-11-AM
- Active rules:
- [AGENT_BRANCH_ENFORCEMENT] Enforce PR-only delivery with protected-branch behavior; never push directly to `main`.
- [AGENT_RETRY_STOP_TWO] After two identical tool failures, stop blind retries and switch strategy with a classified failure note.
- [AGENT_SCOPE_LOCK] Reject out-of-scope edits unless explicitly requested by user constraints.
- [AGENT_DOCS_SCOPE_ENFORCEMENT] In `writeScope: codex-docs-only` runs, scope edits to `.codex/*.md` and codex interaction runbooks unless the task explicitly authorizes a wider surface.
- [AGENT_STARTUP_BLOCK_EVIDENCE_EXTENDED] For startup continuity misses in doc-scoped interaction runs, treat evidence collection as mandatory and include `command`, `signature`, `runId`, `query`, `attempted-tool`, `exit status`, and first signal before one unblock-and-retry step.
- [AGENT_STRUCTURED_PR_NOTES] PR updates must include friction evidence, structural rationale, risk assessment, and QA observation guidance.
- [AGENT_STARTUP_BLOCK_PROTOCOL] In doc-scoped runs, treat startup continuity misses (`missing-auth`, transport/timeout, `401`) or strict-mode bootstrap `skip`/`duplicate` as hard pause conditions until one unblock action is recorded, then retry only after strategy change.
- [AGENT_STARTUP_CONTEXT_TOOLING] For startup continuity misses (`missing-auth`, `401`, `status 0`, transport timeout), record blocker evidence first, then invoke startup memory recovery with task-specific query terms, stable `runId`, `expandRelationships: true`, and `maxHops: 3` before any broader workflow retries.
- [AGENT_STARTUP_BLOCK_BUDGET] For unchanged startup-block signatures in docs-only interaction runs, perform exactly one unblock action (`--run-id` shift, AM/PM defer, auth-path repair) after recording evidence (`command`, `runId`, `query`, first signal), then stop retries for that signature unless the unblock action changes context.
- [AGENT_DOCS_HEALTH_CHECKS] In `writeScope: codex-docs-only` runs, gate completion on strict doc-health harnesses: `npm run codex:docs:drift:strict` and `npm run codex:doctor:strict`; log command, signal, and unblock action for any failure.
- [AGENT_INTERACTION_DEFERRED_LOCK] In doc-only interaction runs, treat `structuralDecision.mode: Deferred` or `skipped` states caused by existing rolling issue/PR locks as a hard pause on structural edits; resume after one unblock action (run-id shift or AM/PM defer) or explicit emergency override.
- [AGENT_INTERACTION_NOOP_GUARD] If `codex:interaction:apply` resolves to `Deferred` with no proposed structural rules, log the no-op signature (`command`, `runId`, `reason`) and take one unblock action before any rerun of the same workflow signature.
- [AGENT_INTERACTION_RETRY_BOUNDARY] For identical unchanged interaction signatures, stop after a first definitive deferral/skip signal, capture blocker evidence (`command`, `runId`, `reason`), and switch strategy before any repeated retry.
- [AGENT_APPLY_WORKTREE_RECOVERY] In `codex:interaction:apply`, classify a `dirty worktree` refusal as a workspace-block signature, record blocker evidence (`command`, `runId`, `signal`), then run exactly one unblock action (clean/stash/commit or one `--allow-dirty` retry) before any broader rerun.
<!-- codex-interaction:auto:end -->
