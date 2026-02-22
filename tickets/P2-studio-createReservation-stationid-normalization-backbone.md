# P2 — Reservation create station field normalization and capacity compatibility

Status: Completed
Date: 2026-02-17
Priority: P2
Owner: Functions Team
Type: Ticket

## Problem

Reservation create path accepts and stores kiln/station identifiers that are not consistently normalized to station-capacity metadata in use by the queue and board layers.
This can produce inconsistent load accounting when stations are renamed/aliased or board routing uses a different station list.

## Scope

- `functions/src/createReservation.ts`
- `functions/src/websiteKilnBoard.ts`
- `functions/src/reservationStationConfig.ts`

## Tasks

1. Replace hard-coded kiln ID validation in create flow with shared station config normalization.
2. Accept legacy aliases (`reductionraku`, etc.) only through normalization, not as raw stored values.
3. Normalize and persist `assignedStationId`/`kilnId` consistently so board capacity math reads the same source of truth.
4. Add tests for valid/invalid station IDs and alias inputs.
5. Add a migration note for legacy reservations that already use non-normalized IDs.

## Acceptance Criteria

- New reservations only persist normalized station IDs that exist in `reservationStationConfig`.
- Station capacity calculations in board and queue flows use the same normalized ID source.
- Invalid/stale IDs return clear `INVALID_ARGUMENT`-style responses in API responses.
- Legacy identifiers are safely mapped (not rejected silently) where policy allows.

## Completion Notes (2026-02-22)

- Replaced legacy kiln-id handling with shared station normalization/validation in:
  - `functions/src/apiV1.ts`
  - `functions/src/createReservation.ts`
- Added create-path validation for unknown station ids with `INVALID_ARGUMENT` error envelope.
- Persisted `assignedStationId` alongside normalized `kilnId` for create flows.
- Normalized kiln doc ids in board rendering to avoid alias-driven station splits in `functions/src/websiteKilnBoard.ts`.
