# P2 — Stripe Webhook Mode Selection and Telemetry

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-01-stripe-payment-webhook-hardening.md

## Problem
Webhook mode logic can drift between runtime profiles without an audit trail, and production incidents become hard to diagnose.

## Objective
Add deterministic mode selection and observability around webhook verification path resolution.

## Scope
1. Define the accepted mode enum for webhook behavior.
2. Make mode-to-secret mapping explicit in request handling.
3. Add counters and tags for mode, source, and validation outcomes.
4. Add dashboards/alerts for sustained webhook failure patterns tied to mode mismatches.

## Tasks
1. Introduce a typed mode decision helper in `functions/src/stripeConfig.ts`.
2. Emit structured telemetry for mode selected, secret source, and signature validation.
3. Add a small failure-rate alert for repeated mode-mismatch signatures.

## Acceptance Criteria
1. Every webhook verify attempt emits mode and source metadata.
2. Recovery from misconfiguration requires explicit configuration correction, not implicit fallback.
3. Operations has a queryable failure signal for mode mismatch and missing-secret cases.

## References
- `functions/src/stripeConfig.ts:383`
- `functions/src/stripeConfig.ts:1157`
