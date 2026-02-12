# P1 — Agent Audit Ledger and Observability

**Status:** Open

## Problem
- Payments and physical fulfillment require forensics-grade traceability.
- Without consistent telemetry, abuse and failures are hard to investigate.

## Goals
- Implement append-only audit logs for all agent actions.
- Provide operational metrics for fraud, latency, and fulfillment health.

## Scope
- `agentAuditLogs` with actor, principal, action, target, outcome, requestId, timestamp.
- Dashboard metrics: quote count, reserve->pay conversion, failure codes, high-risk review volume.
- Correlation IDs across API + Stripe webhook + fulfillment updates.

## Security
- No secrets/PII in log payloads.
- Staff-read only for sensitive audit collections.
- Tamper-evident write pattern where feasible.

## Acceptance
- Every agent write action creates an audit record.
- Staff can filter logs by agent, principal, order, or requestId.
- Alerts trigger on abnormal auth failures and risk spikes.
