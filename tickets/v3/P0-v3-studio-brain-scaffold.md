# P0: Studio Brain Scaffold (TypeScript + Postgres + Job Runtime)

## Goal
Create a local `studio-brain` package with config, Postgres stores, migrations, job runner, and append-only event log foundations.

## Non-goals
- No replacement of cloud authority.
- No production write automation.
- No new portal behavior changes.

## Acceptance Criteria
- `studio-brain/` package exists with build/test scripts.
- Postgres schema migrations create state, diff, job, and event log tables.
- Runtime starts locally with `/healthz` endpoint.
- EventStore and StateStore interfaces are pluggable; Postgres implementation is default.
- Anchor mode defaults enforce local orchestration-only posture.

## Files/Dirs
- `studio-brain/package.json`
- `studio-brain/src/**`
- `studio-brain/migrations/**`
- `docs/STUDIO_OS_V3_ARCHITECTURE.md`

## Tests
- Unit tests for hash stability.
- Unit tests for job runner success/failure path.
- Build compiles in strict mode.

## Security Notes
- No Stripe secrets in local runtime.
- Writes disabled by default in config.
- Event log must include input/output hashes.

## Dependencies
- Existing Firebase cloud surfaces remain unchanged and reachable.
- Local Postgres availability (dev + CI where needed).

## Estimate
- Size: M

## Telemetry / Audit Gates
- Startup event logged with anchor mode flags.
- Migration execution events recorded.
- Job run begin/success/failure audit events stored locally.

## Rollback
- Stop local runtime; cloud portal/functions continue unaffected.
- Drop local `studio-brain` package from deployment path (no cloud dependency).
