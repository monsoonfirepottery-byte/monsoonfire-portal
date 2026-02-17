# P2: OS Cockpit Surface Consolidation

## Goal
Provide one staff cockpit for StudioState, connectors, proposals, approvals, and audit timelines.

## Non-goals
- No migration of member-facing portal routes.
- No mandatory replacement of existing staff modules at launch.

## Acceptance Criteria
- Cockpit presents: latest state, proposal queue, connector health, and audit timeline.
- Filters by severity, target system, and approval state.
- Zero blank-screen behavior with explicit error states.
- Read-only mode available when proposal system is disabled.

## Files/Dirs
- `web/src/views/staff/**` (or local dashboard expansion)
- `studio-brain/src/http/**`

## Tests
- UI tests for empty/loading/error/success states.
- Integration tests for proposal list and audit timeline retrieval.
- Coverage now includes staff action payload assertions in `web/src/views/staff/StudioBrainModule.test.tsx` for:
- missing admin-token access gate (no bootstrap fetches),
- kill-switch toggle request contract (`enabled`, `rationale`),
- intake override deny path contract (`decision`, `reasonCode`, `rationale`).

## Progress Notes
- 2026-02-17: Added targeted cockpit action-flow regression tests for admin-token gating, kill-switch toggles, and intake deny overrides.

## Security Notes
- Staff-only visibility for privileged controls.
- No secret rendering in cockpit logs.

## Dependencies
- `P0-v3-dashboard-studio-state-diffs.md`
- `P1-v3-capability-registry-proposal-approval-audit.md`
- connector tickets for health stream visibility

## Estimate
- Size: L

## Telemetry / Audit Gates
- Cockpit interaction metrics: queue aging, approval latency, connector incident MTTR.
- Error budget dashboard for local brain surfaces.

## Rollback
- Feature-flag off cockpit routes/modules.
- Fall back to existing staff module navigation.
