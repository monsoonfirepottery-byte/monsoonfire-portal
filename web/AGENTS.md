# web/ - Agent Guide (React/Vite)

## Purpose
Reference UI and test harness for the future iOS app. Keep UI logic thin; business rules belong in Cloud Functions.

## Entry points
- Vite entry: `web/index.html` loads `web/src/main.tsx`
- Main UI: `web/src/App.tsx`

## Key modules
- `web/src/api/portalContracts.ts` - canonical request/response contracts (used by web + iOS)
- `web/src/api/portalApi.ts` - HTTP client + troubleshooting metadata
- `web/src/api/functionsClient.ts` - generic functions client (not always used)
- `web/src/hooks/useBatches.ts` - active/history subscriptions
- `web/src/hooks/useTimeline.ts` - timeline subscriptions

## Major flows (UI)
- Auth: Google sign-in via Firebase Auth
- Active/History: Firestore subscriptions on `batches`
- Create batch: `createBatch` HTTP (dev requires `x-admin-token`)
- Close batch: `pickedUpAndClose` HTTP (dev requires `x-admin-token`)
- Continue journey: `continueJourney` HTTP with `{ uid, fromBatchId }`
- Timeline: read from `batches/{batchId}/timeline`
- Troubleshooting: last request payload/response/status + curl example

## Firestore queries (common index pitfall)
- Active: `ownerUid == uid` AND `isClosed == false` ORDER BY `updatedAt desc`
- History: `ownerUid == uid` AND `isClosed == true` ORDER BY `closedAt desc`
These can require composite indexes. If the query fails, create the index.

## Cloud Functions calls (must match)
- All calls include `Authorization: Bearer <idToken>`
- Dev-only: include `x-admin-token` if provided
- continueJourney body MUST include `{ uid, fromBatchId }`

## Safety rails expected in App.tsx
- ErrorBoundary at/near top-level
- In-flight guard to prevent double submit
- Clear button labels:
  - "Continue journey (creates new batch)"
- Troubleshooting panel:
  - last request payload
  - last response + status
  - curl generator (when idToken available)

## Firestore undefined rule
Never write undefined to Firestore. Omit or use null.
