# P0: Cloud-Truth Guardrails + Drift Detection

## Goal
Prevent local StudioState from being mistaken as authoritative by enforcing provenance labels, staleness checks, and drift alerts.

## Non-goals
- No auto-repair writes to cloud data.
- No cross-system reconciliation decisions in this ticket.

## Acceptance Criteria
- Every local snapshot includes source timestamp metadata and source hash references.
- Local dashboard labels all values as `Derived from cloud`.
- Staleness threshold is configurable; stale snapshots trigger warning state.
- Drift checker compares key counters to cloud summary reads and logs mismatches.

## Files/Dirs
- `studio-brain/src/studioState/**`
- `studio-brain/src/jobs/**`
- `studio-brain/src/http/dashboard.ts`

## Tests
- Unit tests for staleness evaluation.
- Unit tests for drift detector threshold logic.
- Snapshot provenance schema test.

## Security Notes
- Do not include raw personal payloads in drift logs.
- Drift alarms should not expose privileged cloud identifiers in UI.

## Dependencies
- `P0-v3-studio-state-readonly-computation.md`

## Estimate
- Size: S

## Telemetry / Audit Gates
- Drift events include metric name, expected/observed values, and confidence level.
- Snapshot staleness warnings include threshold and age.

## Rollback
- Disable drift checks but keep provenance labels active.
- Keep stale-state warning banner always visible if checks are disabled.
