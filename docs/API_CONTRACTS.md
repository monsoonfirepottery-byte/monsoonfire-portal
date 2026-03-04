# Monsoon Fire Portal — API Contracts (Web + iOS Reference)

This document is the source of truth for calling backend Cloud Functions from clients.

Canonical contract definitions:
- `web/src/api/portalContracts.ts`
- `web/src/api/portalApi.ts` (request/response behavior + troubleshooting metadata)

Use `docs/API_CONTRACTS.md` as the API reference when implementing or testing clients.

---

## Environments

### Production
- Base URL: `https://us-central1-monsoonfire-portal.cloudfunctions.net`

### Functions emulator
- Base URL: `http://127.0.0.1:5001/monsoonfire-portal/us-central1`

## Web environment selection

The web client uses:
- `VITE_FUNCTIONS_BASE_URL` when set
- otherwise production base URL

`Vite` loads env vars at process start, so restart `npm --prefix web run dev` after changing it.

---

## HTTP conventions

- Verb: `POST`
- Content type: `application/json`
- Endpoint format: `${BASE_URL}/<functionName>`

Required header:
- `Authorization: Bearer <FIREBASE_ID_TOKEN>`

Admin-gated endpoints:
- `x-admin-token: <ADMIN_TOKEN>`

Notes:
- Never post real auth tokens in screenshots or chat.
- Keep `x-admin-token` scoped to local/dev use only.

### Emulator admin token

Admin-gated emulator calls also require function runtime env var:
- `ADMIN_TOKEN=<your_dev_admin_token>`

If missing, you'll get:
- `401` with `{ ok: false, message: "ADMIN_TOKEN not configured" }`

Restart emulator after updating env vars.

---

## Error envelope (observed)

Clients should handle:
- HTTP errors as JSON envelope when present
- Fallback `message` when envelope shape differs
- `code` values:
  - `UNAUTHENTICATED`
  - `PERMISSION_DENIED`
  - `INVALID_ARGUMENT`
  - `NOT_FOUND`
  - `CONFLICT`
  - `FAILED_PRECONDITION`
  - `INTERNAL`
  - `UNKNOWN`

---

## Functions

### createBatch

POST `${BASE_URL}/createBatch`

Request body (`CreateBatchRequest`):
```json
{
  "ownerUid": "string",
  "ownerDisplayName": "string",
  "title": "string",
  "kilnName": "string | null",
  "intakeMode": "string",
  "estimatedCostCents": 2500,
  "notes": "string | null"
}
```

Success response (`CreateBatchResponse`):
```json
{
  "ok": true,
  "batchId": "string (optional)",
  "newBatchId": "string (optional)",
  "existingBatchId": "string (optional)"
}
```

### pickedUpAndClose

POST `${BASE_URL}/pickedUpAndClose`

Request body (`PickedUpAndCloseRequest`):
```json
{
  "uid": "string",
  "batchId": "string"
}
```

Success response (`PickedUpAndCloseResponse`):
```json
{
  "ok": true
}
```

### continueJourney

POST `${BASE_URL}/continueJourney`

Request body (`ContinueJourneyRequest`):
```json
{
  "uid": "string",
  "fromBatchId": "string"
}
```

Success response (`ContinueJourneyResponse`):
```json
{
  "ok": true,
  "batchId": "string (optional)",
  "newBatchId": "string (optional)",
  "existingBatchId": "string (optional)",
  "rootId": "string (optional)",
  "fromBatchId": "string (optional)",
  "message": "string (optional)"
}
```

---

## Client parity note

For iOS parity, keep `ios/PortalModels.swift` aligned with this contract.

For quick checks, match request payload shape before wiring UI and keep response handling tolerant for optional fields.
