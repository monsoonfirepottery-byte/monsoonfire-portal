# P2: Security Chaos + Tabletop Exercise Program

## Goal
Validate that Studio OS v3 fails safely under auth, connector, and policy disruptions using repeatable drills.

## Non-goals
- No production destructive chaos testing.
- No full red-team program in this ticket.

## Acceptance Criteria
- Quarterly tabletop scenarios documented and run: token compromise, connector outage, policy bypass attempt, local DB corruption.
- Staging chaos scripts can simulate kill-switch activation, connector timeout storms, and delegation revocation races.
- Each drill yields action items with owners and due dates.
- Recovery time and safety metrics are tracked against targets.

## Files/Dirs
- `docs/runbooks/STUDIO_OS_V3_INCIDENT_DRILLS.md`
- `studio-brain/scripts/chaos/**`
- `functions/src/tests/security/**`

## Tests
- Integration tests for kill-switch + denied write behavior under degraded conditions.
- Replay/forgery negative tests for privileged endpoints.
- Smoke tests for fallback cloud-only operation path.

## Security Notes
- Run drills with sanitized non-production data.
- Prevent chaos scripts from running in production by hard environment guards.

## Dependencies
- `P1-v3-policy-exemptions-and-kill-switch.md`
- `P2-v3-dr-recovery-and-rebuild-playbook.md`

## Estimate
- Size: M

## Telemetry / Audit Gates
- Drill events captured with scenario ID, start/end time, outcomes, and unresolved risks.
- MTTR and safety breach counters trended over time.

## Rollback
- Disable automated chaos scripts and continue manual tabletop-only mode.
- Keep incident runbooks active regardless of automation state.
