# functions/ - Agent Guide (Cloud Functions)

## Purpose
Authoritative backend API layer. Keep rules here where possible, not in the UI.

## Entry point
- `functions/src/index.ts` (Gen2 HTTP + scheduled jobs)

## HTTP conventions
- Stateless JSON request/response
- Auth via Firebase ID token:
  - `Authorization: Bearer <idToken>`
- Dev-only admin bypass/guard:
  - `x-admin-token: <token>`
  - Never commit secrets; token is stored in env/secret manager

## Key endpoints (current)
- Public/debug: `hello`, `debugCalendarId`, `acceptFiringsCalendar`, `syncFiringsNow`
- Scheduled: `syncFirings` (daily)
- Batches: `createBatch` (admin), `submitDraftBatch`, `pickedUpAndClose` (admin)
- Journey: `continueJourney`
- Lifecycle helpers (admin): `shelveBatch`, `kilnLoad`, `kilnUnload`, `readyForPickup`
- Maintenance: `backfillIsClosed` (admin)

## Known endpoint contracts (must remain compatible)
- continueJourney
  - Request body MUST include: `{ uid, fromBatchId }`
  - Response may return `newBatchId`, `existingBatchId`, or `batchId`

## Firestore write rule
Do not write undefined values to Firestore. Omit fields or set null if schema allows.

## Debugging priorities (when things break)
1) Missing composite Firestore index (failed-precondition)
2) Undefined Firestore value written (kilnName etc.)
3) Missing required request fields (uid/fromBatchId)
4) Missing auth or x-admin-token headers
5) Frontend mistakes (duplicate imports/state variables)
