# Monsoon Fire Portal - Agent Guide

This repo ships a React/Vite web portal as a reference implementation for an eventual iOS (Swift/SwiftUI) client. Keep patterns explicit, debuggable, and portable.

## Agent map (short)
- Key directories:
  - `web/` React/Vite client (Firebase Auth + Firestore + Cloud Functions HTTP)
  - `functions/` Firebase Cloud Functions (Gen2 HTTP + scheduled jobs)
  - `ios/` future iOS client reference
  - `docs/` project notes
- Entry points:
  - Web: `web/index.html` -> `web/src/main.tsx` -> `web/src/App.tsx`
  - Functions: `functions/src/index.ts`
- Major flows:
  - Auth: Google sign-in via Firebase Auth
  - Active/History: Firestore subscriptions on `batches` with composite indexes
  - Actions: `createBatch`, `pickedUpAndClose`, `continueJourney` (HTTP)
  - Timeline: read from `batches/{batchId}/timeline`
  - Troubleshooting: request payload/response/status + curl via `web/src/api/portalApi.ts`
- Common pitfalls:
  - Firestore rejects `undefined` values (omit or use `null`)
  - `continueJourney` requires `{ uid, fromBatchId }` + Authorization header
  - Composite indexes required for active/history queries
  - Missing `x-admin-token` in dev for admin-only endpoints
  - `VITE_FUNCTIONS_BASE_URL` governs which Functions endpoint is used

## Architecture (high level)
- `web/` - React/Vite client
  - Firebase Auth (Google sign-in)
  - Firestore queries (active + history)
  - Calls Firebase Cloud Functions (HTTP endpoints)
  - Safety rails: ErrorBoundary, in-flight guards, troubleshooting panel, admin token persistence
- `functions/` - Firebase Cloud Functions (HTTP)
  - Stateless request/response JSON contracts
  - Authorization: Bearer `<idToken>` (Firebase Auth)
  - Dev-only admin token header: `x-admin-token` (user-pasted; never hardcode)

## Critical contracts / gotchas (do not regress)
1) continueJourney requires uid + fromBatchId
   - Request body MUST include: `{ uid: user.uid, fromBatchId }`
   - Must send `Authorization: Bearer <idToken>`
2) Firestore rejects undefined
   - Never write `undefined` into Firestore payloads
   - Omit the field or use `null` if allowed
3) Composite indexes
   - Queries like `(ownerUid == X) AND (isClosed == false) ORDER BY updatedAt desc` can require a composite index
   - If you see "failed-precondition: query requires an index", create it via the console link
4) Safety rails are required
   - Guard double-submit / repeated calls
   - Use ErrorBoundary near the top-level UI to prevent blank-screen failures
   - Preserve troubleshooting info (payload, response, status, curl)

## Development commands
- `web/`: `npm run dev` (Vite)
- `functions/`: build + emulator/shell per your setup

## How to work in this repo (agent rules)
- Default to full-file replacements when modifying code files.
- Avoid browser-only tricks; keep the UI thin and portable to iOS.
- When changing network calls:
  - log last request payload/response/status
  - include a curl equivalent if possible
- Do not hardcode secrets. `x-admin-token` is always user-provided.

## Definition of Done (for any coding change)
1) List files changed
2) Behavior changes (1-3 bullets)
3) Manual test checklist
4) Known follow-ups (indexes, deploy order, cache, mobile parity)
