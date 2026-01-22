# HANDOFF_EVENTS_2026-01-22.md

## Scope
- Events web UI (list + detail + staff check-in) and admin-only roster endpoint.
- Local emulator fixes (Functions on port 5001).
- Seed script for test events.

## Key files
- Web UI: `web/src/views/EventsView.tsx`, `web/src/views/EventsView.css`
- Functions: `functions/src/events.ts`, `functions/src/index.ts`
- Contracts: `web/src/api/portalContracts.ts`, `web/src/api/portalApi.ts`
- Native mirrors: `ios/PortalContracts.swift`, `ios/PortalApiClient.swift`, `android/.../PortalContracts.kt`, `android/.../PortalApiClient.kt`
- Docs: `docs/API_CONTRACTS.md`, `docs/SCHEMA_EVENTS.md`, `docs/PLAN_EVENTS.md`
- Seed script: `functions/scripts/seedEvents.js`

## How to run locally
1) Build Functions and start emulator from repo root:
   - `npm --prefix functions run build`
   - `firebase emulators:start --only functions`
2) If using Firestore emulator, start it as well or set `FIRESTORE_EMULATOR_HOST`.
3) Seed test events (emulator by default):
   - `node functions/scripts/seedEvents.js`

## What to verify
- Events list loads without CORS errors (Troubleshooting panel shows HTTP status).
- Event detail shows policy copy, add-ons, and ticket state.
- Staff check-in roster loads when admin token is set.
- UNPAID tag appears for checked-in attendees until payment is complete.

## Known follow-ups
- Replace admin-token gating with real staff roles/claims.
- Ensure Firestore composite indexes are created if the emulator/prod returns a failed-precondition error.
- Add staff tooling for event creation or expose a create UI if needed.
- Decide if seed events should be available in prod or remain emulator-only.

## 2026-01-22 UI update
- Events styling aligned with the refreshed surface tokens and card treatments.
