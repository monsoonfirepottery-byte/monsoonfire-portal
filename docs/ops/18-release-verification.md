# Studio Brain Release Verification

This note defines the safe post-deploy verification lane for Studio Brain ops releases. It is read-only and does not replace a human approval gate for deploys, restarts, timer changes, cleanup, package upgrades, database changes, or secret rotation.

## Primary Command

Run from the repo root:

```bash
bash scripts/ops/post_deploy_verify.sh
```

Useful overrides:

```bash
STUDIO_BRAIN_BASE_URL=http://192.168.1.226:8787 \
MISSION_CONTROL_BASE_URL=http://127.0.0.1:14100 \
bash scripts/ops/post_deploy_verify.sh --strict
```

The command covers:

- Studio Brain `/healthz` for liveness.
- Studio Brain `/readyz` for readiness.
- Studio Brain `/health/dependencies` when available.
- Mission Control `/api/mission-control/health`.
- Mission Control `/mission-control/admin` DOM smoke.
- Harness verification through `mission:harness-learn` when available, otherwise the local Studio Brain agent-harness packet if present.
- Idle-worker current effectivity audit through `studio:ops:idle-worker:effectivity:audit:current`.

## Expected Behavior

| Surface | Passing signal | Graceful degradation |
| --- | --- | --- |
| Studio Brain health | endpoint reachable and not reporting `ok=false` | missing `curl` or endpoint failure is reported without secret output |
| Studio Brain ready | endpoint reachable and not reporting `ready=false` | readiness failure is a verification failure, not an attempted repair |
| Mission Control health | endpoint reachable and not reporting `ok=false` | tunnel or service outage is reported with redacted error text |
| Mission Control admin DOM | page has a basic HTML/admin/Mission Control signal | missing DOM signal fails the check |
| Harness | known harness command exits successfully | missing npm/script becomes warning instead of a mutation |
| Idle-worker audit | current audit command exits successfully | missing npm/script becomes warning; audit failures require review |

## Incident Bundle Evidence

For release evidence packets or incident response, use the v2 bundle:

```bash
INCIDENT_BUNDLE_V2_SMOKE=1 INCIDENT_INCLUDE_LOGS=0 bash scripts/ops/incident_bundle_v2.sh output/ops/incidents-v2/release-smoke
```

The command writes a local bundle summary and refreshes `output/ops/incidents-v2/incident-bundle-v2-latest.json`, which the PR readiness packet consumes. `INCIDENT_BUNDLE_V2_SMOKE=1` proves the collection and redaction path without requiring live endpoint evidence; capture a full bundle before service-impacting incident response. Set `INCIDENT_INCLUDE_LOGS=1` only when an operator intentionally wants short redacted journal excerpts. Review the bundle before sharing it outside the ops team.

## CI/SRE Validation

Use the Worker F validation command before PR handoff:

```bash
bash scripts/ops/ops_ci_validate.sh
```

This runs shell syntax checks, verifies the PR readiness and release verification docs exist, smoke-tests the redacted incident bundle v2, and checks the post-deploy verifier help path. It intentionally avoids live endpoint requirements so it can run on Windows or CI-like local shells.

## Release Packet Checklist

| Item | Evidence |
| --- | --- |
| Changed files list | |
| `bash scripts/ops/ops_ci_validate.sh` result | |
| `bash scripts/ops/post_deploy_verify.sh` result | |
| Incident bundle v2 path, if captured | |
| Studio Brain health/ready status | |
| Mission Control health/admin DOM status | |
| Harness status | |
| Idle-worker audit status | |
| Warnings or skipped checks | |
| Follow-up owner/date | |
