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

## Notes
- Firestore rejects `undefined`; the function writes `null` for missing `preferredWindow` entries.
- The client-side view orders results by `createdAt desc` so a composite index may be required if you add additional filters later.
