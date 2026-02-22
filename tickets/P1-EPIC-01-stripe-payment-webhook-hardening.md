# Epic: P1 — Stripe Payment/Webhook Hardening

Status: Completed
Date: 2026-02-18
Priority: P1
Owner: Functions + Security
Type: Epic

## Problem
The production Stripe webhook and mode-selection path still has unsafe placeholder behavior and incomplete fallback handling. This creates ambiguity in which credentials are actually used and increases risk during incident response.

## Objective
Make webhook verification deterministic, auditable, and test-driven across all deployment modes.

## Tickets
- `tickets/P2-stripe-webhook-secret-configuration.md`
- `tickets/P2-stripe-webhook-mode-selection-telemetry.md`
- `tickets/P2-stripe-webhook-verification-contract-tests.md`
- `tickets/P2-stripe-order-state-event-contracts.md`

## Scope
1. Remove placeholder fallback client construction in webhook verification paths.
2. Resolve webhook secret mode via explicit runtime contract.
3. Add telemetry and observability for mode selection and verification failures.
4. Harden tests for invalid signatures, wrong mode, replay attempts, and mixed-mode handling.

## Dependencies
- `functions/src/stripeConfig.ts`

## Acceptance Criteria
1. Webhook signature verification uses explicit mode and explicit secret source.
2. No request can be accepted with ambiguous or placeholder secret resolution.
3. Telemetry exposes mode, verification success/failure, and signed-event metadata.
4. Smoke and contract tests cover production, dev, and test signature behaviors.

## Definition of Done
1. `functions/src/stripeConfig.ts` passes typed checks for mode and secret fallback handling.
2. New tickets complete and linked in the ticket set.
3. No remaining placeholder or silent fallback path for webhook verification mode.
