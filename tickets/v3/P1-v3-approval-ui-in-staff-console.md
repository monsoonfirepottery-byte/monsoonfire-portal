# P1: Approval Queue UI in Staff Console

## Goal
Expose proposals, approval decisions, and execution traces in the existing staff console so operators can approve safely without leaving cloud surfaces.

## Non-goals
- No autonomous approval.
- No direct connector write from UI outside proposal execution flow.

## Acceptance Criteria
- Staff-only route/module shows pending approvals with filters (risk tier, capability, owner, age).
- Decision action requires rationale and records approver identity.
- Proposal details include predicted impact and linked audit chain.
- Rejected proposals can be reopened only by authorized roles with reason.

## Files/Dirs
- `web/src/views/StaffView.tsx` (or module split)
- `web/src/api/**`
- `functions/src/**` (read/approve endpoints if needed)

## Tests
- UI tests for approve/reject flows with in-flight guards.
- Endpoint tests for role enforcement and rationale requirement.

## Security Notes
- Enforce staff role server-side for all approval operations.
- Prevent optimistic UI approval without server confirmation.
- Audit trail is append-only and immutable.

## Dependencies
- `P1-v3-capability-registry-proposal-approval-audit.md`
- Existing staff role claim checks.

## Estimate
- Size: M

## Telemetry / Audit Gates
- Events: `proposal_viewed`, `proposal_approved`, `proposal_rejected`.
- Decision events include actor UID, proposal ID, capability ID, reason code.

## Rollback
- Hide approval UI module behind feature flag.
- Continue capturing proposals in draft-only mode.
