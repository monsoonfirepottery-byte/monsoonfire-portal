# Ticket: P1 — Studio Operations Data Contract & API Parity Epic

Status: Planned
Created: 2026-02-17  
Priority: P1  
Owner: Web + Functions Team  
Type: Epic

## Problem

Operational features are implemented in parts of the backend and client layers, but planning documents still treat them as missing. The API public/router layer and data schema normalization are inconsistent, causing confusion and incomplete UI behavior.

## Goal

Create a single, explicit contract and API parity across:

- Firestore/Functions operation handlers
- API v1 routes
- Web client contracts
- Reservation normalization schema

## Scope

1. Expose reservation lifecycle and station operations via `apiV1`.
2. Document response/request schemas for all reservation operations as first-class contracts.
3. Add/align normalizer mapping for all fields in `docs/SCHEMA_RESERVATIONS.md`.
4. Clarify which fields are optional vs required and defaults.
5. Add operational notes for transition rules and actor permissions.

## Acceptance Criteria

- `apiV1` has routes for:
  - reservation detail fetch
  - stage transition/update
  - station assignment
  - queue/ETA updates
- Contract doc and generated typings (or explicit TS interfaces) include all above fields:
  - stage/queue lifecycle, ETA band, arrival and pickup windows, station ID, storage status, storage/lane hints, SLA fields.
- Normalized reservation output includes missing fields used by UI without fallback dropping.
- A diff between implementation and `tickets/` is resolved:
  - tickets that state “missing” are either closed as `Implemented` or re-scoped to missing behavior.
- No new schema fields are silently dropped in web layer.

## Implementation Notes

- Keep this ticket as the parent of:
  - `P2-studio-operations-web-kiln-board-live-feed-ticket.md`
  - `P2-studio-reservation-normalizer-completeness-ticket.md` (if split)
  - Any existing station/audit tickets that are still blocked by schema mismatch.

## Risks

- Backward compatibility risks if consumers depend on minimal/noisy payloads.
- Need to avoid broad field additions without migration-safe defaults.

## Definition of Done

- API docs updated + reviewed.
- A simple end-to-end smoke check confirms fetch/update works across function -> API -> web path.
- Product owner sign-off on accepted schema fields.
