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
7. Studio Brain preflight (`npm --prefix studio-brain run preflight`)
8. Studio Brain status gate (`node ./scripts/studiobrain-status.mjs --json --gate`)

For a clean local state, each onboarding run should pass host contract scan + smoke + status checks in sequence.
Recommended sequence:
1. `npm run pr:gate`
2. `npm run integrity:check`
3. `npm run studio:host:contract:scan:strict`
4. `npm run studio:status`
5. `npm run pr:gate -- --smoke`

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
- `npm run studio:check` — strict readiness check
- `npm run studio:env:validate` — env-only check
