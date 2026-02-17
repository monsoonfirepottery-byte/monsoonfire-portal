# Monsoon Fire Portal — Reservations schema (Feb 2026)

## Firestore: `reservations`

Each reservation represents capacity requested by a client (not bound to a single kiln).
For operational reliability and customer transparency, the schema should track:
- status lifecycle state,
- load progress state,
- estimated delivery SLA,
- pickup hold and reminder status,
- traceability history.

Fields:
- `ownerUid` (string, required)
- `status` (string) — starts as `REQUESTED`; staff may later set `CONFIRMED`, `WAITLISTED`, or `CANCELLED`.
- `firingType` (string) — `bisque`, `glaze`, or `other`.
- `shelfEquivalent` (number) — quarter/half/full shelf values (0.25, 0.5, 1.0).
- `preferredWindow` (map)
  - `earliestDate` (timestamp | null)
  - `latestDate` (timestamp | null)
- `estimatedWindow` (map, optional)
  - `currentStart` (timestamp | null)
  - `currentEnd` (timestamp | null)
  - `updatedAt` (timestamp | null)
  - `slaState` (`on_track` | `at_risk` | `delayed` | `unknown`)
- `loadStatus` (string | null) — queue placement state used by kiln view (`queued`, `loading`, `loaded`).
- `queuePositionHint` (number | null) — optional display-only position proxy.
- `queueClass` (string | null) — optional operational queue lane label (eg. `studio-kiln-a`, `studio-kiln-b`, `wheel-bay`).
- `queueLaneHint` (string | null) — optional human-readable lane reason (eg. `station-a-only`, `large-batch-eligible`).
- `assignedStationId` (string | null) — primary station/kiln assignment selected by staff.
- `requiredResources` (map | null) — required workflow resources selected during intake (`{ kilnProfile, rackCount, specialHandling }`).
- `stageStatus` (map | null) — current stage snapshot
  - `stage` (`intake` | `queued` | `drying` | `glaze` | `loaded` | `ready_for_pickup` | `stored` | `picked_up` | `canceled`)
  - `at` (timestamp | null)
  - `source` (`client` | `staff` | `system`)
  - `notes` (string | null)
  - `reason` (string | null)
  - `actorUid` (string | null)
  - `actorRole` (string | null)
- `stageHistory` (array<map>, optional) — append-only transition records
  - `fromStage` (string)
  - `toStage` (string)
  - `at` (timestamp)
  - `actorUid` (string)
  - `actorRole` (string)
  - `reason` (string | null)
  - `notes` (string | null)
- `pickupWindow` (map, optional)
  - `requestedStart` (timestamp | null)
  - `requestedEnd` (timestamp | null)
  - `confirmedStart` (timestamp | null)
  - `confirmedEnd` (timestamp | null)
  - `status` (`open` | `confirmed` | `missed` | `expired` | `completed`)
- `storageStatus` (string | null) — `active`, `reminder_pending`, `hold_pending`, `stored_by_policy`
- `readyForPickupAt` (timestamp | null)
- `pickupReminderCount` (number | null)
- `lastReminderAt` (timestamp | null)
- `staffNotes` (string | null)
- `notesHistory` (array<object> | null)
- `arrivalStatus` (string | null) — operational arrival workflow state (`expected`, `arrived`, `overdue`, `no_show`).
- `arrivedAt` (timestamp | null)
- `arrivalToken` (string | null) — member-facing check-in code.
- `arrivalTokenIssuedAt` (timestamp | null)
- `arrivalTokenExpiresAt` (timestamp | null)
- `arrivalTokenVersion` (number | null)
- `linkedBatchId` (string | null) — optional batch id for context.
- `wareType`, `kilnId`, `kilnLabel`, `quantityTier`, `quantityLabel`, `dropOffProfile`, `dropOffQuantity`, `photoUrl`, `photoPath`, `notes`, `addOns` (map | null)
- `createdByUid`, `createdByRole` (string | null)
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
  "estimatedWindow": {
    "currentStart": "2026-02-16T08:00:00Z",
    "currentEnd": "2026-02-18T20:00:00Z",
    "updatedAt": "2026-02-17T02:30:00Z",
    "slaState": "on_track"
  },
  "loadStatus": "queued",
  "queuePositionHint": 4,
  "queueClass": "studio-kiln-a",
  "queueLaneHint": "high-priority-rush",
  "assignedStationId": "studio-kiln-a",
  "requiredResources": {
    "kilnProfile": "large-cone6",
    "rackCount": 2,
    "specialHandling": []
  },
  "stageStatus": {
    "stage": "intake",
    "at": "2026-02-17T02:30:00Z",
    "source": "client",
    "notes": "Created from portal intake form.",
    "reason": null,
    "actorUid": "uid_xyz",
    "actorRole": "client"
  },
  "arrivalStatus": "expected",
  "arrivedAt": null,
  "arrivalToken": "MF-ARR-72XQ",
  "arrivalTokenIssuedAt": "2026-02-17T01:15:00Z",
  "arrivalTokenExpiresAt": "2026-02-18T20:00:00Z",
  "arrivalTokenVersion": 1,
  "stageHistory": [
    {
      "fromStage": "created",
      "toStage": "intake",
      "at": "2026-02-17T02:30:00Z",
      "actorUid": "uid_xyz",
      "actorRole": "client",
      "reason": "Initial intake submitted.",
      "notes": null
    }
  ],
  "pickupWindow": {
    "requestedStart": null,
    "requestedEnd": null,
    "confirmedStart": null,
    "confirmedEnd": null,
    "status": "open"
  },
  "storageStatus": "active",
  "readyForPickupAt": null,
  "pickupReminderCount": 0,
  "lastReminderAt": null,
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
- In-flight guard: clients should disable submit buttons while the function runs; the backend currently rejects repeated near-duplicates with request-level controls.

## Security

- Reservation documents are readable only by `ownerUid` (equal to `request.auth.uid`).
- Creation requires the client to pass `ownerUid` matching their ID and writes the doc with `status: "REQUESTED"`.

## Notes
- Firestore rejects `undefined`; the function writes `null` for missing `preferredWindow` entries.
- `assignedStationId`, `requiredResources`, `queueClass`, `queueLaneHint`, `arrivalStatus`, and `arrivalToken*` are included as operational expansion targets to support station-aware capacity, station-specific fairness, and member-assisted check-in.
- `stageStatus`, `estimatedWindow`, `pickupWindow`, and `storageStatus` are included as expansion targets, currently implemented through phased tickets (P1/P2).
- The client-side view orders results by `createdAt desc`; a composite index may be required if additional filters are added later.
