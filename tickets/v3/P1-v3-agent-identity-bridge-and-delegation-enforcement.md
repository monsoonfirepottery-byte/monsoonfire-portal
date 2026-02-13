# P1: Agent Identity Bridge + Delegation Enforcement

## Goal
Bind agent actions to explicit delegated authority from humans/staff and deny execution when delegation is missing, expired, revoked, or scope-incompatible.

## Non-goals
- No new external identity provider integration.
- No long-lived bearer token model changes in this ticket.

## Acceptance Criteria
- Actor resolution utility outputs `actorType`, `actorUid`, `ownerUid`, and `effectiveScopes`.
- Proposal and execution paths require delegation verification for agent actors.
- Confused-deputy prevention enforces owner/resource binding.
- Staff tooling can inspect delegation decision traces for denied actions.

## Files/Dirs
- `functions/src/authz/**`
- `functions/src/agentPolicy/**`
- `studio-brain/src/capabilities/**`
- `web/src/views/StaffView.tsx`

## Tests
- Unit tests: valid, expired, revoked, wrong-owner, missing-scope delegation cases.
- Integration tests for function endpoints rejecting unauthorized agent actions.

## Security Notes
- Never allow agent actor to masquerade as human principal.
- Denials must be explicit and reason-coded for auditability.

## Dependencies
- `P1-v3-capability-registry-proposal-approval-audit.md`

## Estimate
- Size: M

## Telemetry / Audit Gates
- Delegation decision events include actor UID, owner UID, scope check result, and denial reason.
- Track count of denied confused-deputy attempts.

## Rollback
- Route all agent-originated execution to manual-review queue.
- Disable agent execution while preserving human/staff proposal flows.
