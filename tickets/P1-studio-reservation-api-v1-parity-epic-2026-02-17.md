# P1 — Studio Reservation API v1 Parity and Compatibility Epic

Status: Open
Date: 2026-02-17
Priority: P1
Owner: Web + Functions Team
Type: Epic

## Problem

The reservation platform has reached a partial v1 migration state:
- `apiV1` now hosts canonical reservation create/update/assign behavior.
- legacy compatibility handlers still exist for historical routing paths.
- public docs still emphasize old paths and the same behavior is represented in multiple places.

This creates risk of contract drift, inconsistent client expectations, and slower incident diagnosis when behavior differs by route.

## Goal

Define a single, explicit parity contract for reservation mutation endpoints and a deprecation-safe migration path that keeps compatibility while eliminating behavior skew.

## Scope

- `functions/src/apiV1.ts`
- `functions/src/index.ts`
- `functions/src/assignReservationStation.ts`
- `functions/src/updateReservation.ts`
- `web/src/api/portalContracts.ts`
- `web/src/api/portalApi.ts`
- `docs/SCHEMA_RESERVATIONS.md`
- `docs/STUDIO_OPERATIONS_GAP_MATRIX_2026-02-17.md`

## Tasks

- Add a parity and compatibility spec for all three mutation endpoints:
  - `createReservation`
  - `updateReservation`
  - `assignReservationStation`
- Enforce a single behavioral implementation path for these endpoints in production code, with compatibility wrappers only at transport boundaries.
- Add explicit route-level migration notes (legacy support window, sunset date, and fallback behavior).
- Add regression tests that compare legacy wrappers vs v1 routes for identical outputs and error envelopes under the same payload scenarios.
- Update docs and planning artifacts to state which clients should call v1 paths and which legacy paths remain supported.

## Child tickets

- `P1-studio-v1-legacy-parity-and-observability.md`
- `P2-studio-createReservation-stationid-normalization-backbone.md`
- `P2-reservation-api-contract-documentation-refresh.md`

## Acceptance Criteria

- Any valid legacy call for reservation create/update/assign succeeds with the same semantic result as the matching v1 route.
- Any incompatibility between legacy and v1 flows is documented and has an issue ticket assigned before release.
- At least one automated parity test exists for each of create/update/assign.
- Documentation for consumers clearly marks v1 as default and lists deprecating legacy routes.

