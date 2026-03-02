# Governance Escalation Path

Use this path when requesting a policy exemption for capabilities/connectors.

## Required Request Data
- Capability/connector ID
- Incident or change ticket ID
- Risk tier
- Requested exemption window (start/end)
- Rollback plan
- Owner sign-off

## Routing
1. Submit request to `governance-primary` with incident/ticket reference.
2. If write-capable scope is involved, include `ops-primary` as co-approver.
3. For trust/safety impacts, include `trust-safety-primary`.

## Decision Logging
- All approvals/rejections must be recorded in Studio Brain policy events.
- Reason code must be explicit (`policy_...` or `staff_override_...` as applicable).

## Emergency Path
- Enable kill switch first if active risk is ongoing.
- Approve only time-boxed exemptions.
- Require follow-up rollback verification within 24h.

## Community Safety Kill-Switch Semantics

When using the Staff Governance policy module safety controls:

- `publishKillSwitch=true`
  - Blocks new event create/publish operations (`createEvent`, `publishEvent`) with a temporary pause response.
  - Does not remove already-published events.
- `enabled=false`
  - Disables proactive safety scoring for draft scans and event draft moderation.
- `autoFlagEnabled=false`
  - Keeps scanning available, but stops automatic routing of high-severity drafts into required review.

## Kill-Switch Recovery Checklist

1. Capture incident/ticket ID and rationale in the change log before toggling.
2. Confirm pause state in Staff Governance posture and run one verification request.
3. Mitigate root cause.
4. Restore normal defaults (`enabled=true`, `autoFlagEnabled=true`, `publishKillSwitch=false`).
5. Verify create + publish paths recover, then log rollback completion time.
