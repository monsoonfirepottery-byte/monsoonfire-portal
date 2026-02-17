# P2: Spec Governance + Capability Policy Lint

## Goal
Institutionalize v3 safety by requiring structured specs and lint checks for capabilities/connectors.

## Non-goals
- No heavyweight process bureaucracy.
- No blocking of low-risk doc-only changes unrelated to capabilities.

## Acceptance Criteria
- ADR/spec template exists for new capabilities/connectors.
- CI lint validates required metadata (risk, owner, approval mode, rollback plan).
- Pull requests adding write-capable capabilities fail CI if policy fields are missing.
- Governance docs define escalation path for exemption requests.

## Files/Dirs
- `docs/specs/**` (new)
- `tickets/v3/**`
- CI workflow updates under `.github/workflows/**`

## Tests
- Lint rule unit tests.
- CI smoke proving pass/fail on compliant/non-compliant examples.

## Security Notes
- Prevents silent expansion of write permissions.
- Makes approval posture and rollback strategy explicit.

## Dependencies
- `P1-v3-capability-registry-proposal-approval-audit.md`
- Existing CI smoke workflow baseline

## Estimate
- Size: M

## Telemetry / Audit Gates
- Weekly report of policy-lint violations by repo area.
- Change log for capability metadata updates.

## Rollback
- Relax lint from blocking to warning if rollout causes excessive friction.
- Keep template docs even if lint gate is temporarily disabled.
