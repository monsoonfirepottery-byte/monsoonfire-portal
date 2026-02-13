# P2: DR, Recovery, and Rebuild Playbook

## Goal
Guarantee operations continuity when local brain fails by documenting and testing rebuild/recovery from cloud truth.

## Non-goals
- No multi-region cloud failover design in this ticket.
- No replacement for existing Firebase disaster procedures.

## Acceptance Criteria
- Runbook covers local brain outage, Postgres corruption, and connector outage scenarios.
- Rebuild command rehydrates local snapshot state from cloud data + event history.
- Tabletop recovery exercise executed and recorded.
- Staff console clearly indicates degraded/local-offline mode.

## Files/Dirs
- `docs/runbooks/STUDIO_OS_V3_DR.md`
- `studio-brain/src/cli/rebuild.ts`
- `web/src/views/StaffView.tsx` (degraded mode messaging)

## Tests
- Rebuild integration test from empty database state.
- Smoke test for degraded mode indicators.

## Security Notes
- Recovery logs should avoid sensitive payload dumps.
- Access to rebuild tooling limited to staff/ops roles.

## Dependencies
- `P0-v3-studio-state-readonly-computation.md`
- `P2-v3-os-cockpit-consolidation.md`

## Estimate
- Size: S

## Telemetry / Audit Gates
- Rebuild start/finish/failure events with correlation IDs.
- Degraded mode entry/exit events visible in audit timeline.

## Rollback
- Disable rebuild CLI endpoint if unstable.
- Operate from cloud-only staff and member surfaces until fixed.
