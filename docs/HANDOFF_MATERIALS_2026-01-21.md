# Handoff - Materials + Stripe Checkout

Date: 2026-01-21
Owner: codex (handoff)
Status: ready for next agent

## Summary
- Materials & Supplies page added with catalog, filtering, cart, pickup notes, and hosted Stripe Checkout redirect.
- Cloud Functions added for catalog listing, checkout session creation, admin seeding, and Stripe webhook processing.
- Inventory enforcement is per-product via `trackInventory` (hard if true, soft if false).
- Docs and READMEs updated to reflect materials + Stripe flow.

## Decisions
- Hosted Stripe Checkout (pickup-only).
- Stripe Tax enabled (`automatic_tax: { enabled: true }`).
- Inventory decremented only after payment (no reservations).

## Files touched (primary)
- Functions: `functions/src/materials.ts`, `functions/src/index.ts`, `functions/package.json`
- Web: `web/src/views/MaterialsView.tsx`, `web/src/views/MaterialsView.css`, `web/src/App.tsx`
- Contracts: `web/src/api/portalContracts.ts`
- Docs: `docs/SCHEMA_MATERIALS.md`, `docs/SCHEMA_ORDERS.md`, `docs/API_CONTRACTS.md`, `docs/MOBILE_PARITY_TODOS.md`
- READMEs: `web/README.md`, `android/README.md`, `ios/README.md`, `codex-agents/README.md`
- Coordination: `AGENTS.md`

## Open tasks / follow-ups
1) Run `npm install` in `functions/` to update `functions/package-lock.json` (install failed due to EPERM).
2) Set Functions env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PORTAL_BASE_URL`.
3) Configure Stripe webhook endpoint to `/stripeWebhook`.
4) Replace sample catalog with real product list + pricing.
5) (Optional) Add Stripe Price IDs and switch from inline `price_data`.
6) Update Firestore rules to allow read access for `materialsProducts` (and appropriate order access for `materialsOrders`).

## Notes / gotchas
- Stripe webhook uses signature verification and does not require Firebase ID tokens.
- `PORTAL_BASE_URL` is required for success/cancel redirects.
- Materials page uses `createFunctionsClient` with troubleshooting panel + curl.
- Firestore currently blocks reads for new collections (rules deny all except profiles/reservations).

## Suggested next steps for incoming agent
1) Fix Firestore rules for `materialsProducts` and `materialsOrders`.
2) Seed real catalog data and verify `listMaterialsProducts`.
3) Validate checkout + webhook path end-to-end with Stripe CLI.
4) Add Stripe Price IDs if/when configured.


## 2026-01-22 update
- Added `functions/scripts/seedMaterials.js` to seed two sample products for emulator testing.
- Updated `docs/SCHEMA_MATERIALS.md` with local seeding instructions.
- Materials styling aligned with refreshed surface tokens and card treatments.
