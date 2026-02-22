# P2 — Continue Journey + History/Timeline Regression Suite

Status: In Progress
Date: 2026-02-22
Priority: P2
Owner: Portal + Functions
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

`continueJourney` has a known contract, but regression coverage across active/history/timeline updates is not comprehensive.

## Objective

Automate `continueJourney` regression validation with assertions across related timeline and history surfaces.

## Scope

- request contract validation (`uid`, `fromBatchId`)
- successful continuation behavior
- error behavior on malformed or missing inputs
- history/timeline post-condition assertions

## Tasks

1. Add unit/integration tests for `continueJourney` request and response contracts.
2. Add post-condition checks for active/history/timeline consistency.
3. Add negative tests for missing IDs and ownership/auth mismatches.
4. Add regression notes to docs if behavior is intentionally non-obvious.

## Acceptance Criteria

1. `continueJourney` success + failure paths are fully covered by automated tests.
2. Active/history/timeline consistency is asserted after continuation.
3. No silent contract drift is possible without test failure.

## Dependencies

- `docs/CONTINUE_JOURNEY_AGENT_QUICKSTART.md`
- `web/src/api/functionsClient.ts`
- `functions/src/apiV1.ts`

## Progress Notes

- 2026-02-22: Added deterministic cross-surface contract consistency check (`scripts/check-continue-journey-contract.mjs`) and wired it into fast/deep journey lanes.
- 2026-02-22: Verified continueJourney request contract usage in `web/src/api/functionsClient.test.ts`, `web/src/api/portalContracts.ts`, and docs.
- Remaining: add dedicated runtime assertions for active/history/timeline post-conditions from continuation execution paths.
