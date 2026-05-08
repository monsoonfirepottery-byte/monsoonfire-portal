# Dependency Security Cadence

Generated: 2026-05-08

## Purpose

Keep the dependency lane boring: verify the all-clean baseline regularly, distinguish active risk from stale external alerts, and use small reviewable PRs for remediation.

## Current Baseline

- Baseline file: `docs/ops/dependency-zero-baseline.json`
- Cadence packet command: `npm run ops:dependency:cadence`
- Guard command: `npm run ops:dependency:zero-baseline`
- Strict guard command: `node scripts/ops/dependency_zero_baseline_guard.mjs --strict --json`
- Current expected state: Dependabot open alerts `0`, active local alerts `0`, stale alerts `0`, npm audit high/critical `0`, npm audit total `0`, upstream-watch items `0`

## Daily Check

Run:

```bash
npm run ops:dependency:cadence
```

Acceptance:

- `status` is `ok`.
- `findings` is empty.
- `output/ops/dependency-cadence/latest.md` exists and summarizes the scout, upstream-watch, and zero-baseline producers.
- GitHub alert evidence is available unless this is an explicitly local-only run.

If the command reports `unknown`, refresh GitHub CLI auth and npm registry access before treating the result as a security finding.

## Weekly Check

Run:

```bash
npm run ops:dependency:cadence
npm run ops:dependency:security-scout
npm run ops:dependency:upstream-watch
npm run ops:dependency:zero-baseline
```

Review:

- new Dependabot alerts
- local `npm audit` high/critical or total count
- vulnerable dependency chains
- whether upstream packages now have a normal update or lockfile-only refresh path

## Stale Alert Workflow

Use stale classification only when:

- GitHub still reports an open alert, and
- the local workspace audit is clean, and
- the vulnerable package is no longer in the affected local audit set.

Safe next step:

1. Re-run `npm run ops:dependency:security-scout`.
2. Confirm `localPosture.classification` is `stale_alert_verify`.
3. Wait for GitHub alert indexing or manually review the alert in GitHub.
4. Do not open a remediation PR for a stale alert unless local evidence regresses.

Rollback:

- There is no code rollback for stale-alert verification.
- If a stale-alert classification is wrong, fix the scout classifier in a PR and rerun the guard.

## Lockfile-Only Refresh Workflow

Use this path when upstream-watch reports `lockfile_refresh_candidate`.

Safe command shape:

```bash
npm update <package> --package-lock-only --ignore-scripts
```

Acceptance:

- Only the intended lockfile changes.
- The root lockfile `name` remains `monsoonfire-portal`.
- `npm audit --package-lock-only --json` reports zero vulnerabilities.
- `npm run ops:dependency:security-scout` reports `status: ok`.
- `npm run ops:dependency:upstream-watch` reports `status: ok`.
- `npm run ops:dependency:zero-baseline` reports `status: ok`.

Rollback:

- Revert the lockfile PR.
- Do not run `npm audit fix` as rollback.

## Normal Update Workflow

Use this path when upstream-watch reports `normal_update_candidate`.

Acceptance:

- Package update is scoped to the owning workspace.
- Tests for the owning package pass.
- Dependency scout and zero-baseline guard return `ok`.
- PR body includes evidence, test output, risk, and rollback notes.

Rollback:

- Revert the dependency PR.
- If the package touches deploy tooling, verify deploy preflight after revert.

## Override Or Upstream-Wait Workflow

Use this path when upstream-watch reports `override_or_upstream_wait`.

Default action:

- Prefer waiting for upstream or opening an upstream issue.
- Use overrides only after a compatibility experiment proves the override is safe.

Required evidence before an override PR:

- dependency chain
- requested range at each parent
- latest compatible and latest major versions
- focused tests for the impacted tool
- rollback instructions

## Approval Boundaries

These are not allowed from this cadence without a separate reviewable PR:

- `npm audit fix`
- package installs unrelated to the finding
- broad dependency upgrades
- override additions without compatibility evidence
- deploys
- host package upgrades
- secret rotation

## Ticket Template

Title:
`[security] remediate dependency regression in <workspace>`

Body:

```markdown
## Problem
The dependency zero-baseline guard no longer reports `ok`.

## Evidence
- Guard status:
- Scout status:
- Upstream-watch status:
- Affected workspace:
- Vulnerable chain:

## Risk
Unreviewed dependency vulnerabilities can remain active or remediation can target the wrong package.

## Proposed Fix
Use the safest classified path: stale-alert verification, lockfile-only refresh, normal update, or override/upstream wait.

## Acceptance Criteria
- `npm audit --package-lock-only --json` is clean for the affected workspace.
- `npm run ops:dependency:security-scout` is `ok`.
- `npm run ops:dependency:upstream-watch` is `ok`.
- `npm run ops:dependency:zero-baseline` is `ok`.

## Safety Notes
- No `npm audit fix`.
- Rollback is reverting the dependency PR.
- Deploy impact is reviewed separately.
```
