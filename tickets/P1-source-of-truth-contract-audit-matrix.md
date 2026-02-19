# P1 — Source-of-Truth Contract Audit Matrix

Status: Completed
Date: 2026-02-18
Priority: P1
Owner: Platform + API + Mobile
Type: Ticket
Parent Epic: tickets/P1-EPIC-08-source-of-truth-deployment-and-store-readiness-audit.md

## Problem

Frontend API contracts, backend handlers, and mobile contract mirrors are validated in separate places with inconsistent evidence.
Without a single, machine-checkable matrix, drift can survive until smoke/gate stages.

## Objective

Create an executable source-of-truth matrix and failing check that validates contract parity across web, backend, and mobile references before promotion.

## Scope

- `web/src/api/portalContracts.ts`
- `functions/src/index.ts`
- `docs/API_CONTRACTS.md`
- `ios/PortalContracts.swift`
- `android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt`
- `scripts/source-of-truth-contract-matrix.mjs` (new)

## Tasks

1. Define canonical contract keys:
   - route names
   - HTTP methods
   - query/body/response schema names
2. Parse and normalize contract surfaces from:
   - web contract source
   - backend route exports
   - API contracts doc
   - iOS and Android contract mirrors
3. Add a matrix check command:
   - `scripts/source-of-truth-contract-matrix.mjs` with JSON output
   - exit non-zero on missing or mismatched entries
4. Add CI/PR integration in `scripts/pr-gate.mjs` and a companion npm script.
5. Add evidence artifact (`output/source-of-truth-contract-matrix/latest.json`) and gate log when matrix is clean.

## Acceptance Criteria

1. Matrix validates at least:
   - `portalContracts.ts` ↔ `API_CONTRACTS.md` ↔ `functions/src/index.ts` route set
   - `portalContracts.ts` ↔ `ios`/`android` contract mirrors
2. Matrix check fails fast on additions and drift with explicit path/file references.
3. PR/gate command can consume JSON output and fail merges on contract divergence.
4. Evidence artifact is generated with timestamp, counts, and mismatch list.

## Dependencies

- `web/src/api/portalContracts.ts`
- `functions/src/index.ts`
- `docs/API_CONTRACTS.md`
- `ios/PortalContracts.swift`
- `android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt`
- `scripts/pr-gate.mjs`
