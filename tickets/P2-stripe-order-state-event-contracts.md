# P2 — Stripe Order and Payment State Contracts

Status: Proposed
Date: 2026-02-18
Priority: P2
Owner: Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-01-stripe-payment-webhook-hardening.md

## Problem
Event-to-state mapping can drift between order and payment handlers, creating gaps not caught by webhook-only tests.

## Objective
Define and enforce a narrow contract for payment state transitions sourced from webhook events.

## Scope
1. Enumerate allowed event -> state transitions for `payment_intent`, `invoice`, and order-related events.
2. Validate transition ordering and idempotency at function boundary.
3. Add integration tests for mixed event arrival orders.

## Tasks
1. Add typed mapping for event types and expected resulting statuses.
2. Add a transition guard table and reject unsupported transitions explicitly.
3. Add observability around unexpected transitions and fallback handling.

## Acceptance Criteria
1. Unsupported transitions return a traceable error path with no silent state mutation.
2. Mixed/missing-order events preserve terminal safety and do not regress state.
3. Contract docs for order/payment events are updated and linked from this ticket set.

## References
- `functions/src/stripeConfig.ts`
- `tickets/P1-agent-quote-reserve-pay-status-v1.md`

