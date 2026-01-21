# web/ — Agent Guide (React/Vite)

## Purpose
Reference UI and test harness for the future iOS app. Keep UI logic thin; business rules belong in Cloud Functions.

## Working directory rule (common pitfall)
Run Vite dev server from **web/**:

- `cd web`
- `npm install`
- `npm run dev`

Do not assume a `dev` script exists at repo root.

## Entry points
- Vite entry: `index.html` loads `/src/main.tsx`
- Main UI: `src/App.tsx`

## Firestore queries (composite index pitfall)
- Active: `ownerUid == uid` AND `isClosed == false` ORDER BY `updatedAt desc`
- History: `ownerUid == uid` AND `isClosed == true` ORDER BY `closedAt desc`
These can require composite indexes. If the query fails, create the index.

## Kiln schedule data (mock + Firestore)
- Collections: `kilns` and `kilnFirings`.
- Kiln Schedule view falls back to mock data when Firestore is empty.
- Dev-only “Seed mock schedule” button can populate Firestore.
- Reminders are downloadable `.ics` files (no email/push yet).

## Reservations flow
- Collection: `reservations`, filtered by `ownerUid` for each client.
- Entries have status, firing type, shelf-equivalent, preferred window, and optional `linkedBatchId`.
- `createReservation` Cloud Function validates the Authorization header, normalizes timestamps, and writes the document with `REQUESTED` status.
- The Reservations view (and its CSS) renders a submission form plus the client’s reservation history (ordered by `createdAt`).

## Profile & settings flow
- `profiles/{uid}` stores displayName, preferred kilns, membership tier/renewal, notification toggles, and studio notes.
- Profile view (`web/src/views/ProfileView.tsx`) surfaces account summary, pieces stats (from `useBatches`), and membership metadata for staff notes/history.
- The client can edit display name, preferred kilns, and notification toggles; saves run through Firestore `setDoc` with `serverTimestamp`.

## Cloud Functions calls (must match)
- All calls include `Authorization: Bearer <idToken>`
- Dev-only: include `x-admin-token` if provided
- continueJourney body MUST include `{ uid, fromBatchId }`

## UI safety rails expected
- ErrorBoundary at/near top-level
- In-flight guard to prevent double submit
- Clear button labels (e.g. “Continue journey (creates new batch)”)
- Troubleshooting capture:
  - last request payload
  - last response + status
  - curl generator (when idToken available)

## Firestore undefined rule
Never write undefined to Firestore. Omit or use null.
