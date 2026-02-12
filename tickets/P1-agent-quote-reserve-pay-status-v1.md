# P1 — Agent Quote/Reserve/Pay/Status v1

Status: Open

## Problem
- Agent commerce needs deterministic transaction endpoints, not chat-only flows.
- Physical fulfillment requires explicit state progression.

## Goals
- Deliver v1 endpoints for quote → reserve → pay → status.
- Keep contract stable and machine-friendly.

## Scope
- Endpoints:
  - `POST /agent/quote`
  - `POST /agent/reserve`
  - `POST /agent/pay`
  - `GET /agent/order/:id`
  - `GET /agent/status/:id`
- Idempotency keys on write operations.
- Fulfillment status taxonomy aligned to kiln operations.

## Security
- Enforce auth scopes per endpoint.
- Reservation finalization depends on verified payment state.
- Log requestId and actor identity on every call.

## Acceptance
- Agent can complete quote/reserve/pay/status happy path in test mode.
- Repeated idempotent writes do not duplicate orders.
- Out-of-order webhook events do not corrupt order state.
