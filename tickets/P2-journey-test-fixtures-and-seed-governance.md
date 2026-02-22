# P2 — Journey Test Fixtures and Seed Governance

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: QA + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-12-portal-user-journey-and-stripe-negative-outcome-testing.md

## Problem

Inconsistent fixture data and seed assumptions make scenario tests brittle and harder to trust.

## Objective

Define deterministic fixture and seed governance for journey and payment test suites.

## Scope

- fixture naming and versioning
- emulator seed contracts
- schema drift guardrails for fixture updates

## Tasks

1. Define fixture folder conventions and naming rules.
2. Add seed contract doc with required/optional fields.
3. Add drift checks for fixture schema assumptions.
4. Add cleanup/reset guidance for local and CI runs.

## Acceptance Criteria

1. Deterministic fixture contracts are documented.
2. Seed expectations are reproducible across local and CI runs.
3. Fixture drift triggers actionable failures.

## Dependencies

- `functions/scripts/seed-emulators.mjs`
- `docs/EMULATOR_RUNBOOK.md`

## Progress Notes

- 2026-02-22: Added fixture baseline under `functions/scripts/fixtures/agent-commerce-smoke.base.json`.
- 2026-02-22: Added deterministic fixture guard script `scripts/check-journey-fixtures.mjs` with schema and secret-marker checks.
- 2026-02-22: Documented fixture governance in `docs/runbooks/JOURNEY_TESTING_RUNBOOK.md`.
