# Monsoon Fire Portal — Dev Runbook (Web + Firebase)

This document is intentionally short and “copy/paste-able”.

## What runs where

- Web UI: Vite dev server (usually http://localhost:5173)
- Auth + Firestore: Firebase SDK (can talk to prod or emulators depending on how you run things)
- Cloud Functions (HTTP): called via a single base URL:
  - Defaults to **prod**: `https://us-central1-monsoonfire-portal.cloudfunctions.net`
  - Can be pointed at **emulators** via `VITE_FUNCTIONS_BASE_URL`

The web app is built to be a reference client for a future iOS app:
- explicit JSON requests
- tolerant parsing
- debugging metadata in the UI

---

## Run web against PROD (default)

From repo root:

```bash
cd web
npm install
npm run dev
```

## Kiln schedule mock data

- Mock data lives in `web/src/data/kilnScheduleMock.ts`.
- The Kiln Schedule view shows a dev-only “Seed mock schedule” button to populate Firestore.
- Reminders are downloadable `.ics` files (no email/push yet).
- TODO:
-   1. Add visibility filters for kiln status (available, firing soon, cooling).
-   2. Add a calendar lane view (day/week) so kilns are rows with firing blocks.
-   3. Surface staff-only controls for triggering firings or setting maintenance windows.

## Profile & settings

- The `Profile` nav item establishes an account overview collage with membership, pieces stats, and studio notes (`web/src/views/ProfileView.tsx` + `ProfileView.css`).
- Users can edit display name, preferred kilns, and notification toggles; the data writes to `profiles/{uid}` via Firestore.
- Recent history is pulled from `useBatches`, so the page balances quick stats with backend truth.

## Kiln reservations

- Reservations live under the `Reservations` nav pill (see `web/src/views/ReservationsView.tsx` + `ReservationsView.css`).
- Requests call the `createReservation` Cloud Function and write into the `reservations` collection with `REQUESTED` status.
- Schema & preferred-window expectations are captured in `docs/SCHEMA_RESERVATIONS.md`.

## Materials & supplies (Stripe Checkout)

- The `Materials` nav item provides a pickup-only catalog + cart (`web/src/views/MaterialsView.tsx`).
- Catalog is served by `listMaterialsProducts` and cached locally for faster reloads.
- Checkout calls `createMaterialsCheckoutSession`, which returns a Stripe-hosted checkout URL.
- Admins can seed a sample catalog via `seedMaterialsCatalog` (requires `x-admin-token`).
- Payment completion is handled via the `stripeWebhook` Cloud Function.

Required Functions env vars:
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PORTAL_BASE_URL` (used for success/cancel redirect URLs)
