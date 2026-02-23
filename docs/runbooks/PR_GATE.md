# PR Gate Runbook

## Purpose
Run a deterministic pre-merge checklist for Studio Brain + portal/site smoke coverage before PR submission.

## Required (minimal) mode
Default `npm run pr:gate` runs these required checks:

1. Required node entrypoints (`scripts/pr-gate.mjs` internal preflight)
2. Studio Brain env contract validation (`npm --prefix studio-brain run env:validate -- --strict --json`)
3. Host profile consistency check for `STUDIO_BRAIN_HOST`, `STUDIO_BRAIN_PORT`, and `STUDIO_BRAIN_BASE_URL`
4. Platform-reference drift scan (`npm run audit:platform:refs:strict`) to catch non-essential OS/tooling assumptions outside host contracts.
5. Studio Brain network runtime contract (`node ./scripts/studiobrain-network-check.mjs --gate --strict --write-state`)
6. Stability guardrails (`npm run guardrails:check -- --strict`) (warning-level)
7. Studio Brain emulator contract (`npm run studio:emulator:contract:check -- --strict --json`)
8. Studio stack profile snapshot (`npm run studio:stack:profile:snapshot:strict -- --json --artifact output/studio-stack-profile/latest.json`)
9. Source-of-truth contract matrix (`npm run source:truth:contract:strict`)
10. Source-of-truth deployment matrix (`npm run source:truth:deployment -- --phase all --json --artifact output/source-of-truth-deployment-gates/pr-gate.json`)
11. Source-of-truth index audit (`npm run source:truth:index:strict`)
12. Runtime contract docs freshness (`npm run docs:contract:check`)
13. Agent-readable surfaces check (`npm run agent:surfaces:check`)
14. Studio Brain preflight (`npm --prefix studio-brain run preflight`)
15. Studio Brain status gate (`npm run studio:check:safe -- --json --no-evidence --no-host-scan`)
16. Well-known validation (`npm run well-known:validate:strict`) (warning-level)
17. Backup freshness check (`npm run backup:verify:freshness`) (warning-level)
18. Reservation schema docs sync check (`npm run docs:reservations:check`) to ensure reservation fields remain documented in `docs/SCHEMA_RESERVATIONS.md`.

`source:truth:index:strict` now treats local `~/.codex/config.toml` MCP-key gaps as advisory by default so PR gate remains deterministic across machines.
To enforce local alias presence intentionally, run:
- `npm run source:truth:index:strict -- --require-local-mcp-keys`
- or set `SOURCE_OF_TRUTH_REQUIRE_LOCAL_MCP_KEYS=true`

For a clean local state, each onboarding run should pass host contract scan + smoke + status checks in sequence.
Recommended sequence:
1. `npm run pr:gate`
2. `npm run integrity:check`
3. `npm run studio:host:contract:scan:strict`
4. `npm run guardrails:check`
5. `npm run studio:status`
6. `npm run studio:host:contract:evidence`
7. `npm run pr:gate -- --smoke`
8. `npm run source:truth:contract:strict`
9. `npm run source:truth:deployment -- --phase all --json --artifact output/source-of-truth-deployment-gates/pr-gate.json`
10. `npm run agent:surfaces:check`
11. `npm run well-known:validate:strict`
12. `npm run audit:platform:refs:strict`

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
npm run house:status
npm run house:watch
npm run house:report
```

Suggested cadence:
- During day shifts: `npm run reliability:watch -- --interval-ms 60000`
- Before cutover handoff: `npm run reliability:once -- --json`

Artifacts are written to `output/stability`:
- `heartbeat-summary.json` (latest gate result)
- `heartbeat-events.log` (append-only event trail)

When a critical check fails, reliability hub now captures an incident bundle by default:
- `output/incidents/<timestamp>/bundle.json`
- `output/incidents/<timestamp>/bundle.sha256`
- `output/incidents/<timestamp>/bundle.tar.gz`
- `output/incidents/latest.json`

## Severity Model

Use these levels for operator triage:

1. `green` (`pass`): all critical checks passed.
2. `yellow` (`warn`): non-critical checks failed; continue with caution and log follow-up.
3. `red` (`fail`): at least one critical check failed; cutover/handoff is blocked until resolved.

Default triage notes:

1. `yellow`:
   - run `npm run house:report`
   - open a ticket or add a same-day note with artifact path
2. `red`:
   - run `npm run incident:bundle`
   - attach bundle path + `output/stability/heartbeat-summary.json` to triage thread
   - do not proceed with cutover PR merge

## EoD Evidence Requirement

Before end-of-day handoff on active Studiobrain work, capture and reference:

1. `npm run house:status`
2. `npm run house:report`
3. `npm run incident:bundle` only if status is `red` (or if requested by QA)
4. Artifact paths in handoff notes:
   - `output/stability/heartbeat-summary.json`
   - `output/stability/heartbeat-events.log`
   - `output/incidents/latest.json` (if generated)

## Studiobrain cutover gate
Use this for deterministic end-to-end readiness from a fresh Studiobrain workstation:

```bash
npm run studio:cutover:gate
```

Behavior:
- Stops immediately on required-step failures (integrity, host contract, network gate, preflight, status, portal smoke).
- Runs website smoke as a non-blocking optional check (captured in the artifact with status/warning metadata).
- Writes a machine-readable artifact to `output/cutover-gate/summary.json` by default.

Expected runtime:
- `npm run studio:cutover:gate -- --no-smoke`: typically under 90 seconds.
- `npm run studio:cutover:gate -- --portal-deep`: typically 2-6 minutes.
- First-failure behavior is intentional; hard dependency failures should return quickly with remediation in step output.

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
- `npm run hardening:check` — deterministic hardening regression tests (errors + request telemetry + local storage safety + function client checks)
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
