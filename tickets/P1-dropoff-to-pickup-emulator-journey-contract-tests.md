# P1 — Dropoff to Pickup Emulator Journey Contract Tests

Status: Completed
Date: 2026-02-22
Priority: P1
Owner: Functions + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

Lifecycle transitions for intake/dropoff through pickup closeout are not currently validated as a deterministic end-to-end contract in emulator-backed automation.

## Objective

Add emulator-driven contract tests that validate lifecycle transitions and output envelopes across key journey stages.

## Scope

- reservation lifecycle state transitions
- pickup-ready and pickup-closeout transitions
- permission checks and error envelopes for invalid transitions

## Tasks

1. Add seeded emulator fixtures for lifecycle journey records.
2. Add test cases for valid transition sequence from intake to pickup closeout.
3. Add negative tests for out-of-order and unauthorized transitions.
4. Assert contract envelope parity for success/failure responses.
5. Export deterministic artifacts for CI debugging.

## Acceptance Criteria

1. Emulator suite validates successful lifecycle progression from intake to pickup closeout.
2. Invalid transitions fail with explicit error contracts.
3. Tests are deterministic and run without external network calls.

## Dependencies

- `functions/src/apiV1.ts`
- `functions/scripts/seed-emulators.mjs`
- `functions/src/apiV1.test.ts`

## Progress Notes

- 2026-02-22: Added deterministic reservation journey contract tests in `functions/src/apiV1.test.ts` for pickup/dropoff requirements, invalid lifecycle transitions, and cancelled-list filtering behavior.
- 2026-02-22: Wired these scenarios into fast/deep journey lanes via `scripts/run-journey-suite.mjs`.
