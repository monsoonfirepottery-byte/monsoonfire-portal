# P0: Studio Brain Observability Baseline

## Goal
Ship structured logs, event IDs, and health/readiness observability so v3 is operable from day one.

## Non-goals
- No third-party monitoring dependency requirement.
- No anomaly intelligence beyond core health and job outcomes.

## Acceptance Criteria
- Structured logger format standardized (level, ts, component, event, requestId/jobId).
- Health endpoint and readiness endpoint provided.
- Job runner emits begin/success/failure metrics/events.
- Correlation IDs flow across job + connector calls.

## Files/Dirs
- `studio-brain/src/observability/**`
- `studio-brain/src/http/server.ts`
- `studio-brain/src/jobs/**`

## Tests
- Unit tests for log serializer.
- Integration smoke test for health/readiness endpoints.

## Security Notes
- Logs must redact secrets and personal payload detail.
- Fail closed for malformed health probes that attempt command injection parameters.

## Dependencies
- `P0-v3-studio-brain-scaffold.md`

## Estimate
- Size: S

## Telemetry / Audit Gates
- Startup + shutdown lifecycle events logged.
- Every job run has a terminal event (`succeeded` or `failed`) with reason code.
- Health/readiness failures trigger warning severity with component tags.

## Rollback
- Keep minimal logs + `/healthz` only.
- Disable readiness gate while retaining core runtime.
