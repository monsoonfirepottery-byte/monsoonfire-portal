# P1: Capability Registry + Proposal/Approval + Immutable Audit

## Goal
Introduce capability definitions and a proposal/approval workflow that gates all external writes.

## Non-goals
- No broad autonomous write execution.
- No bypass of existing cloud authz models.

## Acceptance Criteria
- Capability registry supports risk tier, read/write mode, limits, approval requirement.
- Proposal object includes rationale, predicted effects, and input hash.
- Approval transition is explicit (`pending_approval` -> `approved/rejected`).
- Execution events append immutable audit entries with input/output hashes.
- Policy exemption is narrowly scoped and logged.

## Files/Dirs
- `studio-brain/src/capabilities/**`
- `studio-brain/src/stores/**`
- `web/src/views/staff/**` (if surfacing in staff console)

## Tests
- Unit tests for capability policy checks.
- Unit tests for approval enforcement and audit append.
- Negative tests for unauthorized execution attempt.

## Security Notes
- Least privilege capability boundaries.
- No write without approval unless explicit exemption policy exists.
- Actor attribution mandatory for all transitions.

## Dependencies
- `P0-v3-studio-brain-scaffold.md`
- Existing v2 claims/delegation context from functions/authz model.

## Estimate
- Size: L

## Telemetry / Audit Gates
- Proposal lifecycle events: created, submitted, approved/rejected, executed.
- Every execution record includes capability id, approval id, input/output hashes.
- Denied execution attempts have structured reason codes.

## Rollback
- Feature flag capability execution path off.
- Continue draft-only mode with existing cloud operations.
