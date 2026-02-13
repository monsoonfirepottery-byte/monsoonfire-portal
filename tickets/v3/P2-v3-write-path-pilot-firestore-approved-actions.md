# P2: Narrow Write-Path Pilot (Approved Firestore Actions Only)

## Goal
Pilot one narrowly-scoped write flow (low-risk Firestore update) through the full capability + proposal + approval pipeline.

## Non-goals
- No Stripe/payment writes in this pilot.
- No physical-world actuation in this pilot.

## Acceptance Criteria
- One explicit action class is approved for pilot (for example: append staff-visible ops note).
- Action requires valid capability, proposal approval, and policy pass.
- Dry-run output is visible before execution.
- Execution writes include full audit linkage and idempotency key.
- Rollback command path exists for pilot action.

## Files/Dirs
- `functions/src/v3Execution/**`
- `studio-brain/src/capabilities/**`
- `web/src/views/StaffView.tsx` (pilot execution view)

## Tests
- Integration test for approved write success path.
- Negative tests for missing approval, expired proposal, replay attempt.

## Security Notes
- Keep action allowlist explicit and immutable per release.
- Enforce owner/resource binding to prevent confused deputy behavior.

## Dependencies
- `P1-v3-capability-registry-proposal-approval-audit.md`
- `P1-v3-policy-exemptions-and-kill-switch.md`
- `P1-v3-approval-ui-in-staff-console.md`

## Estimate
- Size: M

## Telemetry / Audit Gates
- Events: dry-run generated, execution requested, execution succeeded/failed, rollback invoked.
- Audit event must include proposal id, approval id, idempotency key, and resource pointer.

## Rollback
- Disable pilot capability ID from registry.
- Enable kill switch and revert affected writes via rollback command path.
