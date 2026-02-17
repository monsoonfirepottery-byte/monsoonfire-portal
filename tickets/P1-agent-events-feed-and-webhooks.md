# P1 — Agent Integrations: Events Feed (Pull) + Optional Webhooks (Push)

Status: Completed

## Problem
- Agents need to react to changes (piece stage updates, batch closed, firing scheduled, etc.).
- Pure polling over multiple collections is:
  - expensive,
  - brittle,
  - easy to get wrong.
- Webhooks provide push, but implementing them naively creates SSRF and abuse risks.

## Goals
- Provide a **safe, durable events stream** agents can consume.
- Prefer a pull-based **cursor feed** first (no outbound calls).
- Add webhooks only with explicit safety constraints.

## Non-goals
- Realtime streaming/SSE for v1 (defer).
- Public unauthenticated feeds.

## Phase A (recommended): Events feed (pull)
### Storage
Collection: `integrationEvents/{eventId}`
- `at: timestamp`
- `uid: string` (owner uid this event belongs to)
- `type: string` (enum-like string)
- `subject: map` (stable identifiers, ex `{ batchId, pieceId }`)
- `data: map` (small payload; no sensitive data)
- `cursor: number` (monotonic increasing integer per uid)
- `expiresAt?: timestamp` (optional TTL for storage bounds)

Cursor strategy:
- Store `integrationEventCursors/{uid}` with `nextCursor: number`.
- On write:
  - transaction: increment cursor, write event with that cursor.

### Event types (start small)
- `batch.updated`
- `batch.closed`
- `piece.updated`
- `reservation.updated`
- `firing.updated`

### API endpoint
`POST /v1/events.feed`
- Auth: Firebase OR PAT with scope `events:read` (add scope in PAT ticket).
- Body:
  - `uid?: string` (default caller uid; staff can request other uids)
  - `cursor?: number` (exclusive; return events with cursor > this)
  - `limit?: number` (default 100, max 500)
- Response:
  - `{ ok: true, data: { events: IntegrationEvent[], nextCursor: number }, requestId }`

### Production writing strategy
Don’t attempt to emit events for *everything* at once.
Start with the most valuable signals:
1. When functions change state (preferred; explicit and durable):
  - in `functions/src/index.ts` and related modules, after a successful write:
    - call `emitIntegrationEvent({ uid, type, subject, data })`
2. For client-side Firestore writes (if any exist), emit events via:
  - Firestore triggers (later) OR migrate writes into functions.

## Phase B (optional): Webhooks (push)
Webhooks are optional because they introduce:
- SSRF risk (user-controlled URLs)
- backpressure/retry complexity

If implemented, require:
- HTTPS only
- reject localhost + private IP ranges (perform DNS lookup at delivery time)
- per-owner allowlist (or staff-approved endpoints)
- HMAC signatures on every delivery
- strict rate limits and payload size caps

### Storage
Collection: `webhookEndpoints/{endpointId}`
- `ownerUid: string`
- `url: string`
- `events: string[]`
- `secret: string` (stored as secret ref OR encrypted-at-rest approach; do not store plaintext if avoidable)
- `createdAt, updatedAt`
- `disabledAt: timestamp | null`
- `lastDeliveryAt: timestamp | null`
- `lastError: string | null` (truncate)

Deliveries:
Collection: `webhookDeliveries/{deliveryId}`
- `endpointId`
- `eventId`
- `attempt`
- `nextAttemptAt`
- `status: queued|sent|failed|dead`
- `responseStatus?: number`
- `responseBodySnippet?: string` (truncate to 1KB)
- `createdAt, updatedAt`

Delivery worker:
- scheduled function every 1–5 minutes:
  - pick N due deliveries
  - `fetch(endpoint.url, { method: POST, headers: signature, body })`
  - retry with exponential backoff; dead-letter after max attempts

Signature:
- `X-MF-Signature: sha256=<hex>`
- `hex = HMAC_SHA256(endpointSecret, rawBody)`

## Tasks
1. Implement Phase A feed:
  - `functions/src/integrationEvents.ts` with:
    - `emitIntegrationEvent(...)` (transactional cursor allocation)
    - `listIntegrationEvents(...)`
  - add `POST /v1/events.feed` to `apiV1` (from v1 ticket)
2. Emit at least one event type end-to-end from an existing state-changing function (pick a low-risk one first).
3. Add docs + examples to `docs/API_CONTRACTS.md`.
4. (Optional) Implement Phase B webhooks only after Phase A is stable.

## Acceptance
- Agent can call `events.feed` with a cursor and reliably receive ordered events.
- Cursor increments are monotonic and per-owner.
- No sensitive content is emitted by default.
- No outbound webhook deliveries exist unless Phase B is explicitly implemented with SSRF constraints.

## Progress
- Implemented Phase A (pull feed):
  - `functions/src/integrationEvents.ts` (cursor allocation via transaction + list)
  - `POST /apiV1/v1/events.feed` in `functions/src/apiV1.ts`
  - Best-effort event emission from `createBatch` (`batch.updated`)
  - Added required Firestore composite index to `firestore.indexes.json` (`integrationEvents uid+cursor`)
  - Documented `events.feed` in `docs/API_CONTRACTS.md`
- Remaining:
  - Emit additional event types (`batch.closed`, `reservation.updated`, etc.)
  - Decide retention/TTL strategy for `integrationEvents` + add `expiresAt` if needed
  - (Optional) Phase B webhooks after SSRF constraints and delivery worker are designed

## Progress notes
- Expanded best-effort event emission coverage in batch lifecycle handlers:
  - `submitDraftBatch` → `batch.updated`
  - `pickedUpAndClose` → `batch.closed`
  - `continueJourney` → `batch.updated` for the new journey batch
  - `kilnLoad` / `kilnUnload` → `batch.updated` with kiln transition details
- Added existence checks for lifecycle handlers before state writes, preventing accidental implicit doc creation during ops actions.
