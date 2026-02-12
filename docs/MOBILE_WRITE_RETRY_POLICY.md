# Mobile Write Offline + Retry Policy

Date: 2026-02-12
Owner: Platform

## Classification matrix

Online-only writes (fail fast, no queue):
- `continueJourney`
- kiln load/unload actions
- staff roster check-in mutations

Queueable writes (idempotent retries allowed):
- `createReservation`
- event signup/cancel
- device token register/unregister
- agent request create (member-scoped)

## Queue contract
- Persist queue entries in platform-local storage with:
  - `operationId` (UUID)
  - `operationType`
  - `idempotencyKey`
  - `payloadHash`
  - `createdAt`, `lastAttemptAt`, `attemptCount`
- Do not enqueue if payload validation fails locally.

## Retry strategy
- Trigger retries on:
  - app foreground
  - connectivity restored callback
  - periodic background task (best-effort)
- Backoff sequence: 5s, 30s, 2m, 10m, 30m, 30m...
- Hard timeout: 24h then move to `needs_attention`.

## Idempotency rules
- Queueable write must include idempotency key header where supported.
- For endpoints without explicit key support, synthesize deterministic request body IDs.
- On successful replay response, remove queue entry atomically.

## UX behavior
- Show `Queued` status immediately with timestamp.
- Show `Retrying` while attempts are active.
- Show `Needs attention` for terminal failure with clear action: retry now/edit payload/remove.
- Never silently drop queued operations.

## Observability
Emit local diagnostic events (redacted):
- `mobile_write_queued`
- `mobile_write_retry`
- `mobile_write_succeeded`
- `mobile_write_failed_terminal`

Each event includes `operationType`, `attemptCount`, `httpStatus` (if present), `reasonCode`.
