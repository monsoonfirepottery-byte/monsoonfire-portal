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
