# P2 — Agent Risk Engine: Fraud, Velocity, and Manual Review

Status: Completed

## Problem
- Automated actors can amplify abuse quickly across quote/reserve/pay surfaces.
- Static rate limits are insufficient for behavioral fraud patterns.

## Goals
- Add risk scoring with deterministic controls and manual review escalation.
- Prevent rapid abuse while preserving legitimate automation.

## Scope
- Risk factors: auth anomalies, velocity spikes, suspicious SKU mixes, repeated failures.
- Rule outcomes: allow, throttle, require manual review, block.
- Staff queue for flagged transactions with rationale and override controls.

## Security
- Default-deny for unknown high-risk conditions.
- Override requires staff reason code.
- Full audit on risk decisions and overrides.

## Acceptance
- High-risk transactions route to manual review before fulfillment.
- Risk score and triggered rules are visible to staff.
- False-positive overrides are captured for rule tuning.

## Progress notes
- Deterministic risk policy + trust-tier limits implemented in `functions/src/apiV1.ts`:
  - per-client order max caps (`orderMaxCents`)
  - velocity caps (`maxOrdersPerHour`)
  - explicit deny actions with audit logging:
    - `agent_quote_denied_risk_limit`
    - `agent_pay_denied_risk_limit`
    - `agent_pay_denied_velocity`
- Manual-review routing is enforced in reserve/review flow:
  - reservations can move into `pending_review`
  - staff adjudication endpoint: `staffReviewAgentReservation` in `functions/src/agentCommerce.ts`
  - staff decisions (`approve`/`reject`) and reason are audited.
- Staff visibility for risk decisions and denials:
  - `web/src/views/staff/AgentOpsModule.tsx` surfaces denied-event filters and risk-related ops data.
- False-positive/override signals are captured through staff review actions and persisted audit metadata for tuning.
