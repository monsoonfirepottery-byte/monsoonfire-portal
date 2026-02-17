# P2 — Reservation contract and migration documentation refresh

Status: Open
Date: 2026-02-17
Priority: P2
Owner: Product + Web Team
Type: Ticket

## Problem

Public and internal docs still reference legacy assumptions (`createReservation` as primary route) while implementation now routes most reservation operations through `apiV1`.
This creates confusion for implementation, QA, and release readiness.

## Scope

- `docs/SCHEMA_RESERVATIONS.md`
- `docs/STUDIO_OPERATIONS_GAP_MATRIX_2026-02-17.md`
- `web/src/api/portalContracts.ts`
- `web/src/api/portalApi.ts`

## Tasks

1. Document the v1 contract as the primary path for reservation mutations.
2. Document supported legacy routes and expected lifecycle until deprecation.
3. Add migration guidance for integrations still using legacy paths.
4. Add an explicit field matrix for:
   - `assignedStationId`
   - `queueClass`
   - `requiredResources`
   - `stageStatus` and `stageHistory`
5. Add a short contract drift checklist that aligns docs with `portalContracts.ts` and `apiV1` routes.

## Acceptance Criteria

- New contributors can call reservation mutation APIs from docs without guessing route version.
- Migration path is clear for clients currently using legacy URLs.
- No unresolved reference to deprecated route assumptions in schema docs.
- Planned compatibility window is recorded with a review date.

