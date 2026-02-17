# P1 — Agent API v1: Stable JSON Envelope + Scopes + Idempotency

Status: Completed

## Problem
- Agents need a **stable**, **versioned**, **machine-friendly** API surface.
- Current functions are “product endpoints” optimized for the portal UI and internal evolution:
  - no explicit API versioning strategy
  - inconsistent response shapes across endpoints
  - idempotency is present in some flows but not standardized

## Goals
- Add a new API namespace: **API v1**.
- Standardize:
  - response envelope
  - error codes
  - request IDs
  - idempotency
  - auth modes (Firebase ID token + PAT from `P1-agent-integration-tokens.md`)
- Keep existing portal endpoints unchanged (no breaking changes).

## Non-goals
- Generating OpenAPI/SDKs automatically (defer).
- Migrating the portal UI to v1 immediately (optional later).

## Design
### Endpoint style
Prefer a single router function for v1 to simplify docs and clients:
- Cloud Function name: `apiV1`
- URL:
  - `https://...cloudfunctions.net/apiV1/<path>`
  - local: `http://127.0.0.1:5001/<project>/<region>/apiV1/<path>`

If routing under one function is not desired, use per-endpoint functions with names prefixed `v1*`.

### Response envelope
All responses:
- Success:
  - `{ ok: true, data: <T>, requestId: string }`
- Error:
  - `{ ok: false, code: string, message: string, requestId: string, details?: object }`

Codes:
- `UNAUTHENTICATED`
- `UNAUTHORIZED`
- `INVALID_ARGUMENT`
- `NOT_FOUND`
- `FAILED_PRECONDITION`
- `RATE_LIMITED`
- `INTERNAL`

### Request ID
On every request:
- read `x-request-id` if present; else generate `req_<base64url>`
- echo as `requestId` in response
- include `x-request-id` in response headers

### Auth + scopes
- Use `requireAuthContext(req)` (from PAT ticket) for v1 endpoints.
- For PAT requests, require explicit scopes per endpoint (fail with `UNAUTHORIZED` if missing).
- For Firebase ID token requests:
  - allow all “self” reads
  - for staff-only operations, require staff claim (`request.auth.token.staff` or roles contains `staff`).

### Idempotency
For any “create” / “state transition” endpoints:
- Require `clientRequestId` (string) in body OR support `Idempotency-Key` header.
- Use existing helper `makeIdempotencyId(prefix, uid, clientRequestId)`.
- Store idempotency record:
  - `idempotency/{id}`: `{ at, uid, prefix, response, status, expiresAt }`
  - If same idempotency ID is seen again within TTL, return stored response.
- Add Firestore TTL via `expiresAt` if desired (see existing TTL patterns).

## Minimal v1 endpoints (Phase 1: read-only)
1) `POST /v1/batches.list`
- Auth: Firebase OR PAT `batches:read`.
- Body:
  - `ownerUid?: string` (if omitted, default to caller uid; if present and != caller uid, staff-only)
  - `limit?: number` (default 50, max 200)
  - `includeClosed?: boolean` (default false)
- Data returned should match canonical contracts in `web/src/api/portalContracts.ts` where possible.

2) `POST /v1/batches.get`
- Auth: Firebase OR PAT `batches:read`.
- Body: `{ batchId: string }`
- Enforce:
  - owner/editor can read
  - staff can read

3) `POST /v1/batches.timeline.list`
- Auth: Firebase OR PAT `timeline:read`.
- Body: `{ batchId: string, limit?: number }`

4) `POST /v1/firings.listUpcoming`
- Auth: Firebase OR PAT `firings:read`.
- Body: `{ limit?: number }`

### Implementation note (authorization)
All v1 endpoints run as admin, so enforce access explicitly:
- Batch reads must verify:
  - `batches/{id}.ownerUid == uid` OR
  - `batches/{id}.editors includes uid` OR
  - staff claim.

Do not rely on Firestore rules for admin SDK reads.

## Tasks
1. Create `functions/src/apiV1.ts` implementing routing + helpers:
  - `jsonOk(res, data, requestId)`
  - `jsonError(res, httpStatus, {code,message,details?}, requestId)`
  - `withCors(req,res)` (reuse `applyCors`)
  - `withAuth(req)` (reuse `requireAuthContext`)
2. Export `apiV1` from `functions/src/index.ts` using `onRequest({ region: REGION }, ...)`.
3. Implement the Phase 1 endpoints above (Zod-validated request bodies).
4. Add docs to `docs/API_CONTRACTS.md`:
  - v1 envelope + codes
  - endpoint docs + examples
5. Add a minimal “agent smoke test” script:
  - `scripts/agent_smoke.ps1` or `functions/scripts/agent_smoke.js`
  - calls emulator endpoints with PAT.

## Acceptance
- v1 endpoints exist locally (emulator) and in prod without affecting existing endpoints.
- All v1 responses use the envelope + requestId.
- PAT scopes are enforced correctly.
- Read authorization matches portal rules (owner/editor/staff).
- No sensitive values are logged (Authorization headers, PAT secrets).

## Progress
- Implemented:
  - `functions/src/apiV1.ts` router with `{ ok, requestId, data }` envelope + error codes
  - Exported `apiV1` from `functions/src/index.ts`
  - Endpoints:
    - `/v1/hello`
    - `/v1/batches.list`
    - `/v1/batches.get`
    - `/v1/batches.timeline.list`
    - `/v1/firings.listUpcoming`
    - `/v1/events.feed`
  - Added rate limiting + `Retry-After` on v1 endpoints (per-route limits)
  - Added safe error mapping for missing Firestore composite indexes (`FAILED_PRECONDITION`)
  - Documented v1 in `docs/API_CONTRACTS.md`
- Remaining:
  - Add idempotency record storage for v1 “write” endpoints when they are introduced (deferred until write routes exist)

## Progress notes
- Added and validated `functions/scripts/agent_smoke.js` for emulator/prod PAT smoke coverage:
  - exercises `/v1/hello`, `/v1/batches.list`, and `/v1/events.feed`
  - supports retry on `429` using `Retry-After`
