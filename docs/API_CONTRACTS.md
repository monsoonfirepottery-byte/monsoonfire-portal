# Monsoon Fire Portal — API Contracts (Web + iOS Reference)

This doc is the single “how do I call the backend” reference for Monsoon Fire Portal clients.

Source of truth for shapes/types:
- `web/src/api/portalContracts.ts`
- `web/src/api/portalApi.ts` (HTTP client behavior + meta/troubleshooting)

---

## Environments

### Production (deployed Cloud Functions)
Base URL:
- `https://us-central1-monsoonfire-portal.cloudfunctions.net`

Example endpoint:
- `${BASE_URL}/createBatch`

### createReservation

POST `${BASE_URL}/createReservation`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `Content-Type: application/json`

Request body (`CreateReservationRequest`):
```json
{
  "firingType": "glaze",
  "shelfEquivalent": 0.5,
  "preferredWindow": {
    "earliestDate": "2026-02-09T10:00:00.000Z",
    "latestDate": "2026-02-11T22:30:00.000Z"
  },
  "linkedBatchId": null
}
```

Response:
```json
{
  "ok": true,
  "reservationId": "abc123",
  "status": "REQUESTED"
}
```

`createReservation` verifies the ID token, trims the shelf equivalent to quarter/half/full values, validates that earliest ≤ latest, and writes the `reservations/{id}` document with `preferredWindow` timestamps plus `createdAt/updatedAt`.

### Local emulator (Firebase Functions emulator)
Base URL:
- `http://127.0.0.1:5001/monsoonfire-portal/us-central1`

Example endpoint:
- `${BASE_URL}/createBatch`

Client selection:
- Web app uses `VITE_FUNCTIONS_BASE_URL` if set; otherwise falls back to prod default.
- App UI shows an **Emulator / Prod** badge derived from the base URL.

Important:
- Vite reads env vars at startup. If you change `VITE_FUNCTIONS_BASE_URL`, restart `npm run dev`.

---

## Authentication & headers

All function calls are **HTTP POST** with JSON.

Required headers:
- `Content-Type: application/json`
- `Authorization: Bearer <FIREBASE_ID_TOKEN>`

Dev-only admin header (required for admin-gated endpoints):
- `x-admin-token: <ADMIN_TOKEN>`

Notes:
- Never paste real `Authorization` tokens into chat/logs. Treat them as credentials.
- The web UI lets you paste `x-admin-token` and persists it in localStorage for convenience.

---

## Emulator admin token requirement

When using the Functions emulator, admin-gated endpoints also require the emulator to have a configured token to compare against.

Symptom:
- `401` with `{ ok: false, message: "ADMIN_TOKEN not configured" }`

Fix:
- Ensure the emulator process has an environment variable set:
  - `ADMIN_TOKEN=<your_dev_admin_token>`
- Then restart the emulator (env vars are read at process start).

PowerShell example:
- `$env:ADMIN_TOKEN="..."; firebase emulators:start --only functions`

bash example:
- `ADMIN_TOKEN="..." firebase emulators:start --only functions`

---

## Functions

### createBatch

POST `${BASE_URL}/createBatch`

Headers:
- `Authorization: Bearer <ID_TOKEN>`
- `x-admin-token: <ADMIN_TOKEN>` (if endpoint is admin-gated)

Request body (`CreateBatchRequest`):
```json
{
  "ownerUid": "string",
  "ownerDisplayName": "string",
  "title": "string",
  "intakeMode": "string",
  "estimatedCostCents": 2500,
  "kilnName": null,
  "notes": null
}
