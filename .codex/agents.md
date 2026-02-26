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

- Last structural update: n/a
- No active automated addenda.
<!-- codex-interaction:auto:end -->
