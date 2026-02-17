# P1 — Agent Integrations: Scoped Integration Tokens (PATs)

Status: Completed

## Problem
- Agents / external automations need **non-interactive** access to the Portal backend.
- Today the backend expects `Authorization: Bearer <Firebase ID token>` which:
  - requires an interactive user session,
  - expires quickly,
  - is not ergonomic for server-side agents or long-running workflows.

## Goals
- Add **revocable**, **scoped** integration tokens that can authenticate to new “agent-safe” API endpoints.
- Keep existing portal behavior intact (web/iOS/Android clients should keep using Firebase ID tokens).
- Provide an audit trail: token created, used, revoked.

## Non-goals
- Full OAuth “Sign in with Monsoon Fire” for third-party apps (defer).
- Anonymous/unauthenticated API access.

## Design (v1)
### Token format
- Plaintext token returned once on creation:
  - `mf_pat_v1.<tokenId>.<secret>`
- `tokenId`: ~16 bytes `base64url` (no padding).
- `secret`: ~32 bytes `base64url` (no padding).

### Storage (Firestore, admin-only)
Collection: `integrationTokens/{tokenId}`
- `ownerUid: string` (the user who created it)
- `label: string | null` (display name in UI)
- `scopes: string[]` (see “Scopes”)
- `createdAt: timestamp`
- `updatedAt: timestamp`
- `lastUsedAt: timestamp | null`
- `revokedAt: timestamp | null`
- `secretHash: string` (HMAC-SHA256 of `secret`)

Hashing:
- Use `crypto.createHmac("sha256", INTEGRATION_TOKEN_PEPPER).update(secret).digest("hex")`
- `INTEGRATION_TOKEN_PEPPER` must be configured via Firebase Secrets (do not commit).

### Scopes
Start with a minimal set:
- `batches:read`
- `pieces:read`
- `timeline:read`
- `firings:read`
- `reservations:read`
- (optional later) `reservations:write`, `requests:write`

### Auth middleware
Add a new auth helper that does not break existing callers:
- New helper: `requireAuthContext(req)` which returns:
  - `{ ok: true, uid, mode: "firebase"|"pat", decoded?, scopes? }`
  - or `{ ok: false, message }`

Rules:
- If bearer token matches `mf_pat_v1.*.*`, treat as PAT:
  - parse `tokenId` + `secret`
  - fetch `integrationTokens/{tokenId}`
  - reject if not found / revoked
  - verify `secretHash` with constant-time compare
  - attach `req.__mfAuth = { uid: ownerUid, scopes, mode: "pat" }`
- Otherwise, fallback to existing Firebase ID token path (use existing `requireAuthUid` + decoded cache).

### Auditing
Write audit records (admin-only collection):
Collection: `integrationTokenAudit/{eventId}`
- `at: timestamp`
- `type: "created"|"used"|"revoked"|"failed_auth"`
- `tokenId: string`
- `ownerUid: string | null`
- `ipHash: string | null` (hash IP, do not store raw IP)
- `userAgent: string | null` (truncate to 256 chars)
- `details: map` (safe metadata only; never store secrets)

## API endpoints (v1)
Implement endpoints as individual HTTPS functions (consistent with current style in `functions/src/index.ts`), or under the new v1 router if that ticket is picked up first.

All endpoints require **Firebase ID token** (not PAT) except where explicitly noted.

1) `POST /createIntegrationToken`
- Auth: Firebase ID token.
- Body:
  - `label?: string | null`
  - `scopes: string[]`
- Response:
  - `{ ok: true, tokenId, token }` (token returned once)

2) `POST /listIntegrationTokens`
- Auth: Firebase ID token.
- Response:
  - `{ ok: true, tokens: [{ tokenId, label, scopes, createdAt, lastUsedAt, revokedAt }] }`

3) `POST /revokeIntegrationToken`
- Auth: Firebase ID token.
- Body: `{ tokenId: string }`
- Response: `{ ok: true }`

4) `POST /helloPat` (test-only endpoint)
- Auth: PAT OR Firebase ID token.
- Response: `{ ok: true, uid, mode }`

## Tasks
1. Add `INTEGRATION_TOKEN_PEPPER` to Functions runtime configuration (Firebase Secret Manager preferred).
2. Implement token primitives:
  - `functions/src/integrationTokens.ts` (generate, hash, verify, revoke, list)
  - Ensure no logging of `secret` or full bearer strings.
3. Implement endpoints in `functions/src/index.ts` (or new `apiV1` router if available).
4. Update docs:
  - Add a section to `docs/API_CONTRACTS.md` describing PAT format + endpoints.
5. Add smoke testing steps to `tickets/P1-emulator-runbook.md` or new docs:
  - create token
  - call `helloPat` with token
  - revoke token and confirm `401`.

## Acceptance
- PAT can be created, used, and revoked end-to-end in the emulator and in production.
- Tokens are never stored in plaintext in Firestore.
- `listIntegrationTokens` never returns secrets.
- Existing portal endpoints that rely on Firebase ID tokens remain unchanged.

## Progress
- Implemented:
  - `functions/src/integrationTokens.ts` (create/list/revoke; hash via HMAC-SHA256 pepper)
  - `functions/src/shared.ts` `requireAuthContext` (Firebase ID token + PAT auth) and constant-time hash compare
  - Functions endpoints: `createIntegrationToken`, `listIntegrationTokens`, `revokeIntegrationToken`, `helloPat`
  - `functions/.env.local.example` now includes `INTEGRATION_TOKEN_PEPPER`
  - `docs/API_CONTRACTS.md` includes PAT documentation
- Remaining:
  - Configure `INTEGRATION_TOKEN_PEPPER` via Firebase Secret Manager for production (environment rollout task)

## Progress notes
- Added dedicated `integrationTokenAudit` telemetry:
  - auth middleware now writes `failed_auth` and `used` events for PAT flows
  - token management endpoints now write `created`, `listed`, and `revoked` events
- Added Firestore rules for `integrationTokenAudit/*` (staff read only, no client writes).
