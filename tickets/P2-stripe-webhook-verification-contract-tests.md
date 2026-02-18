# P2 — Stripe Webhook Verification Contract Tests

Status: Proposed
Date: 2026-02-18
Priority: P2
Owner: QA + Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-01-stripe-payment-webhook-hardening.md

## Problem
Replay, signature, and mixed-mode edge cases are not consistently exercised in regression tests for the webhook path.

## Objective
Add deterministic webhook tests that lock down high-risk behavior before hardening releases.

## Scope
1. Unit/integration coverage for invalid and missing signatures.
2. Tests for webhook mode mismatch and placeholder secret rejection.
3. Replay-window and idempotency behavior around duplicate events.
4. Event schema assertions to prevent silent status drops.

## Tasks
1. Add contract tests around `stripeConfig.ts` webhook verification.
2. Add fixture events and headers for valid, expired, duplicated, and wrong-mode requests.
3. Assert proper status payloads and safe failures without data corruption.
4. Add CI-enforced test path for the above cases.

## Acceptance Criteria
1. Regression tests cover the top four webhook failure classes.
2. CI fails on any fallback behavior that bypasses signature verification.
3. Duplicate or replay events do not create inconsistent payment/order transitions.

## References
- `functions/src/stripeConfig.ts`

