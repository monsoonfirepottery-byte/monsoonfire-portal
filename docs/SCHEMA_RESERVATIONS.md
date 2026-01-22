# Monsoon Fire Portal — Reservations schema (Jan 2026)

## Firestore: `reservations`

Each reservation represents capacity requested by a client (not bound to a specific kiln).

Fields:
- `ownerUid` (string, required)
- `status` (string) — starts as `REQUESTED`; staff may later set `CONFIRMED`, `WAITLISTED`, or `CANCELLED`.
- `firingType` (string) — `bisque`, `glaze`, or `other`.
- `shelfEquivalent` (number) — quarter/half/full shelf values (0.25, 0.5, 1.0).
- `preferredWindow` (map)
  - `earliestDate` (timestamp | null)
  - `latestDate` (timestamp | null)
- `linkedBatchId` (string | null) — optional batch id for context.
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

### Sample document
```json
{
  "ownerUid": "uid_xyz",
  "status": "REQUESTED",
  "firingType": "glaze",
  "shelfEquivalent": 0.5,
  "preferredWindow": {
    "earliestDate": "2026-02-10T15:00:00Z",
    "latestDate": "2026-02-13T22:00:00Z"
  },
  "linkedBatchId": "H3T5...",
  "createdAt": "2026-02-01T02:30:00Z",
  "updatedAt": "2026-02-01T02:30:00Z"
}
```

## Cloud Function: `createReservation`

POST `${BASE_URL}/createReservation`

Headers:
- `Authorization: Bearer <ID_TOKEN>` (required; the function uses `verifyIdToken`).
- `Content-Type: application/json`.

Body shape (see `web/src/api/portalContracts.ts`):
```json
{
  "firingType": "bisque",
  "shelfEquivalent": 1.0,
  "preferredWindow": {
    "earliestDate": "2026-02-05T08:00:00.000Z",
    "latestDate": "2026-02-07T22:00:00.000Z"
  },
  "linkedBatchId": null
}
```

The function validates the token, ensures earliest & latest dates are monotonic, normalizes shelf values, and writes the reservation with `status: REQUESTED`. It listens on `reservations` collection so the UI can stream updates.

### Response
- `201 Created` with `{ reservationId, status: "REQUESTED" }` so the client can optimistically display the new record.
- `401 Unauthorized` if the token is missing or invalid.
- `400 Bad Request` when validation fails (invalid shelf size, non-monotonic window, or missing preferred window map).

### Validation highlights
- Token/UID: `ownerUid` is derived from the verified ID token and never overwritten by the request body.
- Preferred window: `earliestDate` and `latestDate` are cast to Firestore `Timestamp`s, empty values convert to `null`, and `earliestDate` must be before or equal to `latestDate` if both are supplied.
- Shelf equivalent: values outside the supported set (0.25, 0.5, 1.0) are rejected to keep capacity math sane.
- Linked batch: optional string kept as `null` when omitted to keep Firestore happy.
- In-flight guard: clients should disable submit buttons while the function runs; the backend will reject repeated near-duplicates by checking `requestId` or timestamp gaps once future idempotency is implemented.

## Security

- Reservation documents are readable only by `ownerUid` (equal to `request.auth.uid`).
- Creation requires the client to pass `ownerUid` matching their ID and writes the doc with `status: "REQUESTED"`.

## Notes
## Notes
- Firestore rejects `undefined`; the function writes `null` for missing `preferredWindow` entries.
- The client-side view orders results by `createdAt desc` so a composite index may be required if you add additional filters later.
