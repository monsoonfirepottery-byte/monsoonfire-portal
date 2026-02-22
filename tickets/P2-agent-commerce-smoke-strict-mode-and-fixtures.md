# P2 — Agent Commerce Smoke Strict Mode and Fixtures

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Functions + QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

Current agent commerce smoke is intentionally tolerant and does not fail on many correctness gaps.

## Objective

Add a strict mode and deterministic fixtures so agent commerce smoke can act as a high-signal regression check.

## Scope

- strict-mode assertions
- deterministic fixture setup
- pass/fail semantics for key workflow expectations

## Tasks

1. Add strict mode flag to `agent_commerce_smoke.js`.
2. Define fixture assumptions and seed preconditions.
3. Fail fast on missing critical outputs and contract mismatches.
4. Emit concise machine-readable summary for CI use.

## Acceptance Criteria

1. Strict mode returns non-zero for contract-breaking outcomes.
2. Standard mode remains available for exploratory use.
3. Fixture requirements are documented.

## Dependencies

- `functions/scripts/agent_commerce_smoke.js`
- `functions/scripts/seed-emulators.mjs`

## Progress Notes

- 2026-02-22: Added `--strict`, `--fixture`, and `--json` support to `functions/scripts/agent_commerce_smoke.js`.
- 2026-02-22: Added deterministic baseline fixture `functions/scripts/fixtures/agent-commerce-smoke.base.json`.
- 2026-02-22: Added strict command wiring in `functions/package.json` and optional deep-lane execution hook in `scripts/run-journey-suite.mjs`.
