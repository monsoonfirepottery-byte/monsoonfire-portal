# Monsoon Fire Portal — Agent Incident Playbook

## Purpose
- Provide deterministic response steps for agent abuse, legal complaints, and payment risk events.

## Severity Ladder
- `SEV-1`: active fraud/abuse with financial or legal exposure.
- `SEV-2`: repeated policy violations or high-risk behavior.
- `SEV-3`: isolated malformed traffic or low-risk misuse.

## Immediate Controls
- Disable agent API globally via staff Agent Ops controls.
- Suspend/revoke agent client keys.
- Place affected requests/orders into manual review.

## Response Workflow
1. Triage alert and assign incident owner.
2. Capture immutable evidence:
   - request IDs, agent client IDs, order IDs, Stripe IDs, audit rows.
3. Contain:
   - kill switch and/or scoped key revocation.
4. Decide:
   - reject, refund, or escalate to legal.
5. Recover:
   - resume access only after policy mitigation is documented.
6. Review:
   - write post-incident summary and follow-up tasks.

## Evidence Requirements
- Preserve `agentAuditLogs` rows.
- Preserve per-request audit subcollection where applicable.
- Capture relevant webhook payload IDs (do not store raw secrets).

## Abuse Reporting
- Tag actions with one of:
  - `fraud_velocity`
  - `copyright_risk`
  - `prohibited_content`
  - `terms_breach`
  - `payment_dispute`

## Exit Criteria
- Impact assessed.
- Controls reset to safe state.
- Owner and follow-up ticket links recorded.
