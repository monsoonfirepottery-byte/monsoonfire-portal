# P2 — Stripe Webhook Secret Configuration and Validation

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-01-stripe-payment-webhook-hardening.md

## Problem
Webhook secret resolution can silently fall back to placeholder values, weakening incident recovery and increasing risk of accepting bad signatures in edge environments.

## Objective
Make secret resolution explicit and fail-safe with strong validation in all non-test environments.

## Scope
1. Audit `functions/src/stripeConfig.ts` for fallback branches around webhook secret construction.
2. Reject placeholder secret formats in production-like mode.
3. Require explicit mode + secret source for each deployment profile.
4. Log and expose which secret strategy was selected for each verify attempt.

## Tasks
1. Replace placeholder fallback path with explicit error or safe no-op block depending on mode.
2. Add startup validation on env config for required secret references.
3. Add structured logs for secret strategy and verification attempt failures.

## Acceptance Criteria
1. No placeholder secret path is used in live webhook verification.
2. A missing required secret returns a clear non-200 webhook response with a structured error field.
3. Logs include selected webhook mode and missing-secret reason for failures.

## References
- `functions/src/stripeConfig.ts:1157`
- `functions/src/stripeConfig.ts:1138`
