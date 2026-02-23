# P2 — Chargeback/Dispute and Refund Ops Simulation Tests

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Functions + Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

Operational risk is highest on disputes/chargebacks/refunds, but current coverage is policy-heavy and simulation-light.

## Objective

Create deterministic simulation tests for dispute and refund operational outcomes.

## Scope

- dispute-created lifecycle handling
- dispute resolution outcomes
- refund and partial refund status handling
- audit/evidence trail assertions

## Tasks

1. Define simulation fixtures for dispute/refund lifecycle events.
2. Add tests for status transitions and invariants under each event sequence.
3. Assert audit metadata is produced for operational triage.
4. Document any intentionally manual steps for unresolved cases.

## Acceptance Criteria

1. Dispute and refund scenarios are executable locally and in CI deep lane.
2. Event ordering and idempotency behavior is asserted.
3. Audit trail evidence is validated in tests.

## Dependencies

- `docs/policies/payments-refunds.md`
- `functions/src/stripeConfig.ts`
- `docs/AGENT_INCIDENT_PLAYBOOK.md`

## Progress Notes

- 2026-02-22: Added deterministic Stripe negative-event contract parsing for dispute and refund flows, including partial-refund amount assertions.
- 2026-02-22: Added lifecycle-status mapping tests for negative payment transitions.
- 2026-02-23: Added explicit dispute-resolution (`charge.dispute.closed`) simulation and dispute lifecycle audit metadata assertions (`functions/src/stripeConfig.ts`, `functions/src/stripeConfig.test.ts`).
