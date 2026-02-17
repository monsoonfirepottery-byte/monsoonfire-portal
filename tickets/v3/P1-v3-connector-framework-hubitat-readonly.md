# P1: Connector Framework + Hubitat (Read-only First)

## Goal
Create connector interface framework and implement Hubitat read-only adapter with capability definitions.

## Non-goals
- No write/control actions in initial Hubitat connector.
- No direct automation of safety-critical devices.

## Acceptance Criteria
- Standard connector interface implemented (health, read, execute with dry-run shape).
- Hubitat connector supports read-only status pulls.
- Capability definitions map Hubitat reads to low-risk read capabilities.
- Connector logs include request IDs and input/output hashes.
- Circuit-breaker/backoff stub exists for unstable endpoints.

## Files/Dirs
- `studio-brain/src/connectors/**` (new)
- `studio-brain/src/capabilities/**`
- `docs/STUDIO_OS_V3_ARCHITECTURE.md`

## Tests
- Unit tests for Hubitat payload normalization.
- Unit tests for connector error classification/backoff behavior.

## Security Notes
- Read-only mode enforced by code and capability policy.
- Any future write actions must require explicit approval.

## Dependencies
- `P1-v3-capability-registry-proposal-approval-audit.md`

## Estimate
- Size: M

## Telemetry / Audit Gates
- Connector health events with availability and latency buckets.
- Per-read call audit entries with hashed input/output and connector version.

## Rollback
- Disable Hubitat connector registration.
- Keep connector framework active for other providers.
