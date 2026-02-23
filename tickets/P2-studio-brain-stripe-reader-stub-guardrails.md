# P2 — Studio Brain Stripe Reader Stub Guardrails

Status: Completed
Date: 2026-02-23
Priority: P2
Owner: Studio-Brain Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-03-mock-data-governance-and-production-hygiene.md

## Problem
Stripe reader stubs are used as integration placeholders and can hide missing payment wiring.

## Objective
Add explicit stub mode controls and prevent hidden activation in operational environments.

## Scope
1. Define supported and disallowed modes for `stripeReader`.
2. Require environment checks before stub behavior can run.
3. Add clear error states for required production integration paths.

## Tasks
1. Update `studio-brain/src/cloud/stripeReader.ts` to include explicit mode signaling.
2. Add startup guard preventing default stub fallback when production dependencies are configured.
3. Add tests for stub/non-stub mode transitions.

## Acceptance Criteria
1. Stub mode is never silently active in production.
2. All fallback activation paths are explicit and logged.
3. Tests confirm production mode rejects stub-dependent data access without a clear error.

## References
- `studio-brain/src/cloud/stripeReader.ts:17`
- `studio-brain/src/cloud/stripeReader.test.ts:1`
