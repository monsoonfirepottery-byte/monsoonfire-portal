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
