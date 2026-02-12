# P2 — Agent Risk Engine: Fraud, Velocity, and Manual Review

**Status:** Open

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
