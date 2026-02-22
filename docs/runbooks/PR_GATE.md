# PR Gate Runbook

## Purpose
Run a deterministic pre-merge checklist for Studio Brain + portal/site smoke coverage before PR submission.

## Required (minimal) mode
Default `npm run pr:gate` runs these required checks:

1. Required node entrypoints (`scripts/pr-gate.mjs` internal preflight)
2. Studio Brain env contract validation (`npm --prefix studio-brain run env:validate -- --strict --json`)
3. Studio Brain runtime integrity check (`npm run integrity:check`)
4. Host profile consistency check for `STUDIO_BRAIN_HOST`, `STUDIO_BRAIN_PORT`, and `STUDIO_BRAIN_BASE_URL`
5. Legacy host-contract scan (`npm run studio:host:contract:scan:strict`)
6. Studio Brain network runtime contract (`node ./scripts/studiobrain-network-check.mjs --gate --strict --write-state`)
7. Stability guardrails (`npm run guardrails:check -- --strict`)
8. Studio Brain preflight (`npm --prefix studio-brain run preflight`)
9. Studio Brain status gate (`npm run studio:check:safe -- --json`)
10. Platform-reference drift scan (`npm run audit:platform:refs:strict`) to catch non-essential OS/tooling assumptions outside host contracts.
11. Source-of-truth contract matrix (`npm run source:truth:contract:strict`).
12. Source-of-truth deployment matrix (`npm run source:truth:deployment -- --phase all --json --artifact output/source-of-truth-deployment-gates/pr-gate.json`).
13. Agent-readable surfaces check (`npm run agent:surfaces:check`).
14. Well-known validation (`npm run well-known:validate:strict`).

For a clean local state, each onboarding run should pass host contract scan + smoke + status checks in sequence.
Recommended sequence:
1. `npm run pr:gate`
2. `npm run integrity:check`
3. `npm run studio:host:contract:scan:strict`
4. `npm run guardrails:check`
5. `npm run studio:status`
6. `npm run pr:gate -- --smoke`
7. `npm run source:truth:contract:strict`
8. `npm run source:truth:deployment -- --phase all --json --artifact output/source-of-truth-deployment-gates/pr-gate.json`
9. `npm run agent:surfaces:check`
10. `npm run well-known:validate:strict`
11. `npm run audit:platform:refs:strict`

## Deployment gate recovery

If `Source-of-truth deployment matrix` fails, run:

```bash
npm run source:truth:deployment -- --phase all --strict --json --artifact output/source-of-truth-deployment-gates/pr-gate.json
```

Then fix the first failed check by file:

1. Workflow contract gaps: update the relevant `.github/workflows/*`.
2. Runbook gaps: update `docs/EMULATOR_RUNBOOK.md`, `docs/runbooks/PORTAL_PLAYWRIGHT_SMOKE.md`, or `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`.
3. Re-run the same command and `npm run pr:gate` until pass.

## Reliability and house-status loop
For daily cutover readiness on Studiobrain, keep an always-on heartbeat record:

```bash
npm run reliability:once
npm run reliability:watch
npm run reliability:report
```

Suggested cadence:
- During day shifts: `npm run reliability:watch -- --interval-ms 60000`
- Before cutover handoff: `npm run reliability:once -- --json`

Artifacts are written to `output/stability`:
- `heartbeat-summary.json` (latest gate result)
- `heartbeat-events.log` (append-only event trail)

## Studiobrain cutover gate
Use this for deterministic end-to-end readiness from a fresh Studiobrain workstation:

```bash
npm run studio:cutover:gate
```

Behavior:
- Stops immediately on required-step failures (integrity, host contract, network gate, preflight, status, portal smoke).
- Runs website smoke as a non-blocking optional check (captured in the artifact with status/warning metadata).
- Writes a machine-readable artifact to `output/cutover-gate/summary.json` by default.

## Extended smoke mode
Run smoke mode for PR confidence:

```bash
npm run pr:gate -- --smoke
```

## Legacy/optional host smoke
For quick, local-only onboarding from `studiobrain` you can still run:

```bash
npm run pr:gate -- --smoke --json --artifact output/pr-gate-smoke.json
```

That appends:

1. `npm run portal:smoke:playwright`
2. `npm run website:smoke:playwright`
3. `node ./scripts/phased-smoke-gate.mjs --phase staging --strict --json`

## Machine-readable artifact
By default, the gate writes `artifacts/pr-gate.json`.
You can override:

```bash
npm run pr:gate -- --json --artifact ./.tmp/pr-gate.json
```

The JSON artifact includes:
- gate status
- each step result (`ok`, `exitCode`, `required`, `remediation`, `output`)
- smoke inclusion flag (`includeSmoke`)

## Failure handling
- Fix the first failed step shown in output.
- Re-run the same command until all required checks pass.
- If a command fails because services are not running, start services and re-run from the top.

## Related commands
- `npm run studio:status` — quick health and contract state
- `npm run studio:check` — status gate for blockable checks
- `npm run studio:check:safe` — strict "all green" readiness for high-risk ops
- `npm run studio:env:validate` — env-only check
- `npm run guardrails:check` — stability guardrails (resource, log, artifact, volume posture)
- `npm run test:journey:fast` — deterministic journey + Stripe negative regression lane
- `npm run test:journey:deep` — expanded journey lane with optional strict agent smoke
- `npm run test:stripe:negative` — Stripe negative-event contract tests only

## Related planning docs
- `docs/runbooks/JOURNEY_AND_STRIPE_TESTING_PLAN.md` — scenario matrix and phased rollout for journey + Stripe negative-outcome regression coverage.
- `docs/runbooks/JOURNEY_TESTING_RUNBOOK.md` — execution, fixtures, and release evidence conventions for journey lanes.
