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

<!-- codex-interaction:auto:start -->
### Automated Structural Addenda

- Last structural update: 2026-02-28-AM
- Active rules:
- [AGENT_BRANCH_ENFORCEMENT] Enforce PR-only delivery with protected-branch behavior; never push directly to `main`.
- [AGENT_RETRY_STOP_TWO] After two identical tool failures, stop blind retries and switch strategy with a classified failure note.
- [AGENT_SCOPE_LOCK] Reject out-of-scope edits unless explicitly requested by user constraints.
- [AGENT_STRUCTURED_PR_NOTES] PR updates must include friction evidence, structural rationale, risk assessment, and QA observation guidance.
<!-- codex-interaction:auto:end -->
