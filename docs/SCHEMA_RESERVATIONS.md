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
  - `confidence` (`high` | `medium` | `low` | null)
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
- `arrivalTokenLookup` (string | null) — normalized uppercase token key for scanner-friendly lookup.
- `arrivalTokenIssuedAt` (timestamp | null)
- `arrivalTokenExpiresAt` (timestamp | null)
- `arrivalTokenVersion` (number | null)
- `arrivalCheckIns` (array<object> | null) — append-only arrival check-in events (`at`, `byUid`, `byRole`, `via`, `note`, `photoUrl`, `photoPath`).
- `linkedBatchId` (string | null) — optional batch id for context.
- `wareType`, `kilnId`, `kilnLabel`, `quantityTier`, `quantityLabel`, `dropOffProfile`, `dropOffQuantity`, `photoUrl`, `photoPath`, `notes`, `addOns` (map | null)
- `createdByUid`, `createdByRole` (string | null)
- `createdAt` (timestamp)
- `updatedAt` (timestamp)

## Arrival token + check-in policy

- Arrival token issuance:
  - Token is issued when reservation status transitions to `CONFIRMED`.
  - Format is deterministic and human-readable: `MF-ARR-XXXX-XXXX`.
  - Determinism seed: reservation id + `arrivalTokenVersion`.
- Expiry rules:
  - If a preferred latest arrival window exists and is in the future, token expiry aligns to that window.
  - Otherwise token defaults to a short rolling window (36 hours from issuance).
- Reissue/revocation:
  - Staff can rotate tokens via `/v1/reservations.rotateArrivalToken`.
  - Rotation increments `arrivalTokenVersion` and invalidates prior lookup keys.
- Check-in paths:
  - Member/owner check-in: `/v1/reservations.checkIn` with `reservationId`.
  - Staff scanner/lookup: `/v1/reservations.lookupArrival` + `/v1/reservations.checkIn` with `arrivalToken`.

## Status lifecycle graph (canonical)

- Reservation status:
  - `REQUESTED` -> `CONFIRMED`
  - `REQUESTED` -> `WAITLISTED`
  - `REQUESTED` -> `CANCELLED`
  - `CONFIRMED` -> `WAITLISTED`
  - `CONFIRMED` -> `CANCELLED`
  - `WAITLISTED` -> `CONFIRMED`
  - `WAITLISTED` -> `CANCELLED`
  - `CANCELLED` is terminal unless an explicit force/admin migration path is used.
- Load status:
  - `queued` -> `loading` -> `loaded`
  - `loaded` may be returned to `queued` by staff correction if needed.
- Every accepted transition appends one `stageHistory` row and updates `stageStatus`.

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

## Reservation Mutation API Contract (v1 default)

Primary mutation routes:
- `POST ${BASE_URL}/apiV1/v1/reservations.create`
- `POST ${BASE_URL}/apiV1/v1/reservations.update`
- `POST ${BASE_URL}/apiV1/v1/reservations.assignStation`

Legacy compatibility wrappers (transport boundary only):
- `POST ${BASE_URL}/createReservation` -> forwards to `/v1/reservations.create`
- `POST ${BASE_URL}/updateReservation` -> forwards to `/v1/reservations.update`
- `POST ${BASE_URL}/assignReservationStation` -> forwards to `/v1/reservations.assignStation`

Compatibility window:
- Legacy wrappers remain supported during migration.
- Review date: `2026-05-15`.
- Sunset target: no earlier than `2026-06-30`.
- Fallback behavior: if a legacy path fails in integration environments, call the matching v1 path with the same JSON payload and headers.

Headers:
- `Authorization: Bearer <ID_TOKEN>` (required).
- `Content-Type: application/json`.
- `x-admin-token: <token>` only when using dev-admin mode in emulator/staff tooling flows.

Response envelope:
- Success: `{ ok: true, requestId, data }`
- Error: `{ ok: false, requestId, code, message, details }`

### Mutation field matrix

- `assignedStationId`
  - Created from normalized `kilnId` during `reservations.create` when station input is provided.
  - Updated by `reservations.assignStation`.
  - Must be a canonical station id from `functions/src/reservationStationConfig.ts`.
- `queueClass`
  - Optional lane label set/updated by `reservations.assignStation`.
  - Stored lowercased/trimmed.
- `queuePositionHint`
  - Server-computed deterministic queue position for the assigned station.
  - Recomputed by reservation create/update/assign mutation flows.
- `estimatedWindow`
  - Server-computed queue ETA window for the assigned station queue.
  - Includes `currentStart/currentEnd`, `slaState`, and `confidence`.
- `requiredResources`
  - Optional structured routing metadata set by `reservations.assignStation`.
  - Shape: `{ kilnProfile, rackCount, specialHandling[] }`.
- `stageStatus`
  - Snapshot of current workflow stage (`intake`, `queued`, `loaded`, `canceled`, etc.).
  - Updated by mutation routes when stage-relevant values change.
- `stageHistory`
  - Append-only transition timeline used for auditability.
  - Station assignment and status/load transitions append entries.

### Validation highlights

- `reservations.create`
  - Validates preferred window ordering (`earliestDate <= latestDate`).
  - Enforces owner auth (`ownerUid` cannot be impersonated by non-staff actors).
  - Validates station input via shared station normalization; unknown station ids return `INVALID_ARGUMENT`.
  - Persists canonical station ids for both `kilnId` and `assignedStationId`.
- `reservations.update`
  - Staff/dev only.
  - Enforces allowed status transitions unless `force: true`.
- `reservations.assignStation`
  - Staff/dev only.
  - Enforces known station ids and station capacity checks.
  - Supports idempotent replay semantics when no net mutation occurs.

### Queue ranking rules (server-computed)

Queue hints are derived server-side per station using a deterministic sort key:
1. reservation lifecycle priority (`CONFIRMED` -> `REQUESTED` -> `WAITLISTED` -> `CANCELLED`)
2. rush priority (`addOns.rushRequested`)
3. whole-kiln priority (`addOns.wholeKilnRequested`)
4. no-show/overdue penalty (`arrivalStatus`)
5. estimated size penalty (`estimatedHalfShelves` fallback chain)
6. created time (`createdAt`)
7. stable id tiebreaker (`reservationId`)

This keeps queue hint ordering consistent across clients and prevents UI-only ordering drift.

### Contract drift checklist

- Keep `web/src/api/portalContracts.ts` aligned with:
  - v1 route names
  - station id input expectations
  - response envelope assumptions
- Keep `functions/src/reservationStationConfig.ts` as the single station id normalization source.
- Keep parity tests current in `functions/src/apiV1.test.ts` for create/update/assign route-family behavior.

## Security

- Reservation documents are readable only by `ownerUid` (equal to `request.auth.uid`).
- Mutation routes require `Authorization: Bearer <ID_TOKEN>` and use actor authorization checks per route.
- Staff/dev actors may act on behalf of members where policy allows; non-staff callers cannot impersonate another owner.

## Notes
- Firestore rejects `undefined`; the function writes `null` for missing `preferredWindow` entries.
- Migration fallback for pre-field reservations:
  - Missing `status` => treat as `REQUESTED`.
  - Missing `loadStatus` => treat as `queued`.
  - Missing `stageStatus`/`stageHistory` => show stable fallback copy and use `updatedAt`.
  - Missing `estimatedWindow`/`queuePositionHint` => use server recompute when next mutation occurs; UI may show fallback ETA text.
- `assignedStationId`, `requiredResources`, `queueClass`, `queueLaneHint`, `arrivalStatus`, and `arrivalToken*` are included as operational expansion targets to support station-aware capacity, station-specific fairness, and member-assisted check-in.
- `stageStatus`, `estimatedWindow`, `pickupWindow`, and `storageStatus` are included as expansion targets, currently implemented through phased tickets (P1/P2).
- The client-side view orders results by `createdAt desc`; a composite index may be required if additional filters are added later.
