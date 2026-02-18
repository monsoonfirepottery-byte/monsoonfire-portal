# P2 — Materials Sample Seeding Contract

Status: Planned
Date: 2026-02-18
Priority: P2
Owner: Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-03-mock-data-governance-and-production-hygiene.md

## Problem
Sample materials seeding can blur the line between test and production data integrity, especially in shared environments.

## Objective
Create a strict seeding contract and environment guardrails for sample material flows.

## Scope
1. Audit all material sample injection paths.
2. Require explicit environment and consent flags for non-empty seeding behavior.
3. Add guardrails in read/write paths to prevent accidental use in production.

## Tasks
1. Add contract comments and runtime checks in `functions/src/materials.ts`.
2. Ensure seeding endpoints and scripts expose explicit opt-in mode.
3. Add warnings and audit logs when sample seeding is triggered.

## Acceptance Criteria
1. Sample seeding is not available by default outside approved dev contexts.
2. Seeding events emit environment + user context.
3. Production integration tests fail if sample seeding occurs implicitly.

## References
- `functions/src/materials.ts:234`
