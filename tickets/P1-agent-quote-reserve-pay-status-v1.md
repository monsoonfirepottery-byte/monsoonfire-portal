# P1 — Agent Quote/Reserve/Pay/Status v1

Status: Completed

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

## Progress notes
- Implemented deterministic v1 commerce endpoints in `functions/src/apiV1.ts`:
  - `POST /v1/agent.quote`
  - `POST /v1/agent.reserve`
  - `POST /v1/agent.pay`
  - `POST /v1/agent.status`
  - `POST /v1/agent.order.get` and `POST /v1/agent.orders.list` for order retrieval.
- Idempotency is enforced on write operations using stable id generation:
  - reservation ids (`makeIdempotencyId("agent-reservation", ...)`)
  - order ids (`makeIdempotencyId("agent-order", ...)`).
- Payment + webhook linkage implemented in `functions/src/stripeConfig.ts`:
  - webhook events map to canonical order/payment state updates.
  - event handling uses event IDs and merge-based updates for retry/out-of-order resilience.
- Auditability present across endpoints:
  - structured audit events written to `agentAuditLogs` with request/actor identity and action metadata.
