# P2: Multi-Studio Boundary Readiness (Platformization Guardrails)

## Goal
Prepare Studio OS for future multi-studio/white-label expansion by defining strict tenancy boundaries and config isolation.

## Non-goals
- No full multi-tenant rollout in this ticket.
- No billing partition implementation.

## Acceptance Criteria
- Architecture doc defines tenant boundary model (IDs, config isolation, audit partitioning).
- Capability policies support tenant-scoped enforcement.
- Connector config supports per-tenant credentials without cross-tenant access.
- Cockpit filters and logs are tenant-aware.

## Files/Dirs
- `docs/STUDIO_OS_V3_ARCHITECTURE.md`
- `docs/specs/multi-studio-boundaries.md`
- `studio-brain/src/config/**`
- `web/src/views/staff/**`

## Tests
- Unit tests for tenant boundary checks in policy evaluation.
- Integration tests for cross-tenant access denial paths.

## Security Notes
- Prevent data bleed across tenants by default deny.
- Tenant context must be explicit in every privileged action and audit entry.

## Dependencies
- `P1-v3-agent-identity-bridge-and-delegation-enforcement.md`
- `P2-v3-os-cockpit-consolidation.md`

## Estimate
- Size: M

## Telemetry / Audit Gates
- Track cross-tenant denial attempts.
- Tenant context completeness metric for audit events.

## Rollback
- Lock runtime to single-tenant mode.
- Disable tenant selection controls in cockpit.
