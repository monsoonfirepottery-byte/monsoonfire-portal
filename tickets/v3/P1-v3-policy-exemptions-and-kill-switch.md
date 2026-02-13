# P1: Policy Exemptions + Global Kill Switch

## Goal
Add narrowly-scoped policy exemptions and an emergency kill switch so automation can be stopped instantly without redeploy.

## Non-goals
- No broad blanket exemptions.
- No hidden bypass routes outside audited policy checks.

## Acceptance Criteria
- Exemptions are capability-scoped, owner-scoped (when applicable), and time-bounded.
- Exemptions require explicit justification and approver attribution.
- Kill switch disables all connector writes and proposal execution paths immediately.
- UI clearly surfaces current policy mode and active exemptions.

## Files/Dirs
- `functions/src/agentPolicy/**`
- `web/src/views/StaffView.tsx` (policy controls)
- `studio-brain/src/capabilities/**`

## Tests
- Unit tests for exemption expiry and scope matching.
- Integration tests that kill switch blocks execution regardless of proposal status.

## Security Notes
- Exemptions are append-only with revoke records, never silently overwritten.
- Kill switch endpoint is staff-only and protected by claims.

## Dependencies
- `P1-v3-capability-registry-proposal-approval-audit.md`
- `P1-v3-approval-ui-in-staff-console.md`

## Estimate
- Size: M

## Telemetry / Audit Gates
- Events: exemption created/revoked/expired, kill switch on/off.
- All blocked executions must include explicit `blocked_by_policy` reason code.

## Rollback
- Force kill switch enabled while preserving read-only paths.
- Remove exemption evaluation and require approvals for all writes.
