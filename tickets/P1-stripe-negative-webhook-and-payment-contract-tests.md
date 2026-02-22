# P1 — Stripe Negative Webhook and Payment Contract Tests

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Functions + Security
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

Stripe webhook support is currently strongest on success events; negative outcomes are under-tested and risk unnoticed contract drift.

## Objective

Add deterministic contract tests for Stripe negative outcomes and webhook idempotency edges.

## Scope

- failed payment events
- dispute/chargeback event handling expectations
- refund event handling expectations
- replay and out-of-order event delivery behavior

## Tasks

1. Expand event-contract mapping tests for negative event types.
2. Add webhook tests for unsupported vs handled events with explicit assertions.
3. Add duplicate/replay and out-of-order ordering tests.
4. Define expected order/payment status outcomes for each negative event.
5. Ensure tests do not require live Stripe services.

## Acceptance Criteria

1. Negative payment event scenarios are covered by automated tests.
2. Replay and ordering cases are asserted with deterministic outcomes.
3. Unsupported events are intentionally documented and tested as ignored or rejected per contract.

## Dependencies

- `functions/src/stripeConfig.ts`
- `functions/src/stripeConfig.test.ts`
- `docs/API_CONTRACTS.md`

## Progress Notes

- 2026-02-22: Expanded webhook contract coverage for `payment_intent.payment_failed`, `invoice.payment_failed`, `charge.dispute.created`, and `charge.refunded`.
- 2026-02-22: Added deterministic parsing/ordering tests, partial-refund amount assertions, and lifecycle-status mapping tests in `functions/src/stripeConfig.test.ts`.
- 2026-02-22: Fixed webhook order lifecycle mapping so negative outcomes no longer collapse to `payment_pending`.
