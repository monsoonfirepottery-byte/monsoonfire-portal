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

- Last structural update: 2026-02-27-PM
- Active rules:
- [USER_BRANCH_POLICY] Include branch policy in scope constraints: PR-only changes, never direct push to `main`.
- [USER_OUTPUT_CONTRACT] Require output sections for behavior change summary, risk assessment, and copyable QA checks.
- [USER_PROMPT_STRUCTURE] Require `Objective`, `Constraints`, `Non-goals`, and `Definition of Done` in implementation prompts.
- [USER_SCOPE_FENCE] Explicitly list in-scope and out-of-scope surfaces to prevent scope creep.
<!-- codex-interaction:auto:end -->
