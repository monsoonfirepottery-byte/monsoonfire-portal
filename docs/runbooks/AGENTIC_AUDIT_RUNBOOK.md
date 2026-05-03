# Agentic Audit Runbook

This runbook keeps repo-wide audits read-only by default and makes mutating automation visible before it is used.

## Safe Audit Commands

- `npm run audit:agentic:inventory`
- `npm run audit:write-surfaces`
- `npm run audit:destructive-surfaces`
- `npm run audit:branch-guard`
- `npm run guard:ephemeral:artifacts`
- `npm run portal:index:guard`
- `npm run firestore:rules:sync:check`

Generated audit reports are written under `output/qa/` so routine inventory runs do not dirty tracked files.

## Branch Isolation

Use `npm run audit:branch-guard -- -- <command...>` for repo-wide checks that must not move branch, HEAD, or git status.

Branch-moving checks, including `npm run branch:divergence:guard`, should run separately from build commands that can touch generated outputs such as `studio-brain/lib/`.

## Generated Artifact Policy

| Path | Policy | Notes |
| --- | --- | --- |
| `output/` | ignored with tracked legacy | Routine QA, smoke, audit, and local verification output is ignored. Existing tracked `output/` evidence is legacy and should not grow. |
| `web/.lighthouseci/` | ignored | Local Lighthouse cache. |
| `.tmp/` | ignored | Local scratch output. |
| `studio-brain/lib/` | tracked intentionally | Compiled Studio Brain runtime mirror. Run build checks apart from branch-moving checks. |
| `docs/generated/` | tracked intentionally | Reviewed source-of-truth snapshots. |
| `artifacts/` | tracked selectively | Stable latest/evidence snapshots only; run-scoped artifacts stay ignored. |
| `test-results/` | tracked legacy review | Historical visual evidence. New output should prefer ignored `output/` paths. |

Run `npm run guard:ephemeral:artifacts` after build/audit work to catch accidentally tracked routine output.

## Command And Workflow Catalog

Run `npm run audit:agentic:inventory` to refresh:

- tracked file surface classes,
- generated artifact policy counts,
- root package scripts by owner, default mode, and side effect,
- workflow write permissions, apply-mode tokens, and dry-run defaults.

Manual and scheduled workflows that mutate GitHub, repo state, live data, or deployment targets should have explicit owner/runbook context. Manual dispatch inputs should default to dry-run unless the workflow is intentionally apply-only.

## Firestore/Auth Write Surface Map

Run `npm run audit:write-surfaces` before production-safety refactors. The generated report groups write-like and auth-boundary signals by owner/scope and lists the verification gate for each group.

The inventory is a triage map, not proof of vulnerability. Use it to choose the next small refactor slice, then verify code-level claims against the touched modules and tests.

## Destructive Command Surfaces

Run `npm run audit:destructive-surfaces` before deploy-script or host-tooling refactors. The report documents the repo-owned live/destructive surfaces, the expected boundary guard, and the available dry-run or fixed-path scope.

Current tracked surfaces include:

- portal Namecheap deploy cleanup and rollback promotion,
- website Namecheap static deploy promotion,
- local portable Java cache refresh,
- Studio Brain Bambu Studio install/smoke cleanup,
- Studio Brain monitoring container bootstrap cleanup,
- Lighthouse workspace cache cleanup,
- Firebase preview-channel pruning,
- temporary credential directory cleanup for Firestore index deploy and virtual staff regression.

Treat new `rm -rf`, recursive `rm`, preview-channel deletion, or remote cleanup commands as audit-owned changes: add a path-boundary assertion first, then register the surface in `scripts/destructive-command-surface-audit.mjs`.
