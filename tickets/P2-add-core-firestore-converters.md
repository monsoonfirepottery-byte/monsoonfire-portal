# P2 — Add Core Firestore Converters

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Functions Team
Type: Ticket
Parent Epic: tickets/P1-EPIC-04-functions-type-safety-and-data-contract-fidelity.md

## Problem
Cross-module conversion logic is inconsistent and often relies on runtime assumptions.

## Objective
Introduce converters for core business entities used in payment and inventory flows.

## Scope
1. Build converters for reservation and material documents.
2. Apply converters at read/write boundaries.
3. Add tests for null/invalid field behavior.

## Tasks
1. Implement converters in `functions/src/index.ts` and `functions/src/materials.ts`.
2. Replace raw snapshot casts with converter-based reads.
3. Add tests for missing/invalid required fields and defaults.

## Acceptance Criteria
1. Converter-based flows reduce cast usage and undefined writes.
2. Failing conversions produce deterministic fallback/error actions.
3. Converters are documented and reused by at least two call sites.

## References
- `functions/src/index.ts:2016`
- `functions/src/materials.ts`

## Completion Notes (2026-02-22)
1. Added reusable converters for reservation, materials order/product, batch, integration events, and jukebox entities in `functions/src/firestoreConverters.ts`.
2. Replaced raw snapshot casts with converter usage in `functions/src/index.ts` and `functions/src/materials.ts`.
3. Added converter tests for malformed/null field handling in `functions/src/firestoreConverters.test.ts`.
