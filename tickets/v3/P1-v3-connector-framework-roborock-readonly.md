# P1: Roborock Connector (Read-only First)

## Goal
Add Roborock read-only connector for device status telemetry under capability policy.

## Non-goals
- No start/stop/zone-clean commands in P1.
- No background autonomous control.

## Acceptance Criteria
- Roborock connector reads status and battery/health telemetry.
- Capability mapping exists for read-only Roborock operations.
- Commands blocked unless capability explicitly allows and approval is granted.
- All connector calls are audited with hashed input/output.

## Files/Dirs
- `studio-brain/src/connectors/roborock/**`
- `studio-brain/src/capabilities/**`

## Tests
- Unit tests for payload mapping and stale data handling.
- Unit tests for read-only enforcement.

## Security Notes
- Physical world connector defaults to read-only.
- Future write operations classified high-risk.

## Dependencies
- `P1-v3-capability-registry-proposal-approval-audit.md`
- Connector framework from Hubitat ticket (or shared connector base ticket split).

## Estimate
- Size: M

## Telemetry / Audit Gates
- Device read metrics (success/error/timeout rate).
- Audit entries include connector/device identifiers and policy mode.

## Rollback
- Remove Roborock connector from registry.
- No impact on core StudioState pipeline.
