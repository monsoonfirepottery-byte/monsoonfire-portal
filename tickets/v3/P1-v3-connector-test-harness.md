# P1: Connector Contract Test Harness

## Goal
Create a reusable harness that validates connector behavior against standard contracts (health, auth, retries, error shape, read-only mode).

## Non-goals
- No production connector performance benchmark suite.
- No write-path tests in initial harness.

## Acceptance Criteria
- Shared connector contract test suite exists and runs for each connector module.
- Harness validates standardized error taxonomy and timeout handling.
- Read-only connector methods fail if write intent is passed.
- CI gate fails when connector deviates from required interface.

## Files/Dirs
- `studio-brain/src/connectors/testing/**`
- `studio-brain/src/connectors/**`
- `studio-brain/package.json` (test scripts)

## Tests
- Contract tests for Hubitat and Roborock connectors.
- Negative tests for auth failure and malformed payload paths.

## Security Notes
- Ensure test fixtures never include real credentials.
- Validate that connector logs redact auth headers/tokens.

## Dependencies
- `P1-v3-connector-framework-hubitat-readonly.md`
- `P1-v3-connector-framework-roborock-readonly.md`

## Estimate
- Size: S

## Telemetry / Audit Gates
- Test harness emits per-connector pass/fail summary artifact.
- Runtime warning if connector reports unsupported capability mapping.

## Rollback
- Temporarily disable strict CI gate while preserving runtime safe defaults.
- Keep manual connector verification checklist in release notes.
