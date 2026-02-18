# PR Gate Runbook

## Purpose
Run a deterministic pre-merge checklist for Studio Brain + portal/site smoke coverage before PR submission.

## Required (minimal) mode
Default `npm run pr:gate` runs these required checks:

1. Studio Brain env contract validation (`npm --prefix studio-brain run env:validate -- --json`)
2. Studio Brain runtime integrity check (`npm run integrity:check`)
3. Host profile consistency check for `STUDIO_BRAIN_HOST`, `STUDIO_BRAIN_PORT`, and `STUDIO_BRAIN_BASE_URL`
4. Legacy host-contract scan (`npm run studio:host:contract:scan:strict`)
5. Studio Brain network runtime contract (`node ./scripts/studiobrain-network-check.mjs --gate --strict --write-state`)
6. Studio Brain preflight (`npm --prefix studio-brain run preflight`)
7. Studio Brain status gate (`node ./scripts/studiobrain-status.mjs --json --gate`)

For a clean local state, each onboarding run should pass host contract scan + smoke + status checks in sequence.
Recommended sequence:
1. `npm run integrity:check`
2. `npm run studio:host:contract:scan:strict`
3. `npm run studio:status`
4. `npm run pr:gate -- --smoke`

## Extended smoke mode
Run smoke mode for PR confidence:

```bash
npm run pr:gate -- --smoke
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
