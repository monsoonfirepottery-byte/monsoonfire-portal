# PLAN_BILLING.md

Date: January 22, 2026
Owner: TBD
Status: Draft

## Goal
Create a Billing page that makes payments feel calm and transparent. It should show what is owed only after attendance, surface paid receipts, and make it easy to complete payment after event check-in or materials pickup orders.

## Non-negotiables
- Events are attendance-only billing. No charge unless the attendee checks in.
- Make the language forgiving and low-stress (clear cancellation cutoff, no surprise charges).
- Never write undefined into Firestore; omit or use null.
- Keep UI logic thin so it ports cleanly to iOS and Android.

## Users
- Clients: see their own orders, receipts, and unpaid check-ins.
- Staff: optional read-only view later (not required for v1).

## Data sources
- `eventSignups` for the attendee status and paymentStatus.
- `eventCharges` for receipts and paid history.
- `materialsOrders` for supplies orders and Stripe Checkout sessions.
- `profiles/{uid}` for display name and email (optional header context).

## Billing page structure (proposed)
1) **Billing overview**
   - Summary tiles: unpaid check-ins, paid last 30 days, pending materials orders.
   - Callout: "You only pay if you attend." with the 3-hour cancellation rule.

2) **Unpaid check-ins**
   - List of events with `status == checked_in` and `paymentStatus != paid`.
   - Action: "Pay now" (launch `createEventCheckoutSession`).

3) **Materials orders**
   - Recent orders with status: `checkout_pending`, `paid`, `picked_up`.
   - Show totals, pickup notes, and last updated timestamp.

4) **Receipts and history**
   - Combined stream of `eventCharges` and `materialsOrders` (paid only).
   - Filters: All, Events, Materials.

5) **Help and policies**
   - Short FAQ for cancellations, attendance-only billing, and how receipts are delivered.
   - Link to Support view for billing questions.

## Primary actions
- Pay now (event check-in payment via Stripe Checkout).
- View receipt (link to Stripe receipt URL if stored, or show local details).
- Refresh data.

## Empty and error states
- Empty states for no billing history.
- Loading indicators per section.
- Inline errors that preserve the request metadata in TroubleshootingPanel if using Functions.

## Security and access
- Clients can read only their own orders and charges.
- If Firestore rules block `materialsOrders`, add rules or move reads behind a Cloud Function.

## Backend plan
- Option A: Direct Firestore reads (current focus)
  - Use client-side Firestore to read `materialsOrders`, `eventSignups`, `eventCharges` for the signed-in user.
  - Firestore rules must allow authenticated reads when `resource.data.uid == request.auth.uid`.
- Option B: Cloud Function aggregator (fallback if rules stay stricter)
  - New endpoint: `listBillingSummary` — aggregates unpaid event check-ins, materials orders, and receipts in a single response so clients can build the billing overview without relaxing Firestore rules.
  - Input: optional filters (date range via `from`/`to`, max `limit`).
  - Response: normalized items (`unpaidCheckIns`, `materialsOrders`, `receipts`) plus summary totals, matching `BillingSummaryResponse` in `portalContracts.ts`. Keep the mobile mirrors in sync.

## Open questions
- Do we want a staff-only billing console or keep Billing client-only?
- Should event receipts store a Stripe receipt URL for deep linking?
- Should we allow partial payment or staff-waived charges?

## Mobile parity
- Mirror the Billing summary in iOS and Android after the web page is stable.
- Use the same low-stress policy copy and receipt grouping rules.

## Local seeding
- Run `node functions/scripts/seedBilling.js` (with `FIRESTORE_EMULATOR_HOST` pointing at `127.0.0.1:8080` or your emulator) to create:
  - A checked-in event signup with an unpaid paymentStatus for `seed_raku_night`.
  - A paid `eventCharges` record with line items for the same event.
  - Two materials orders (one pending, one paid) so the summary cards and receipts have data.
- The script is emulator-safe and logs the affected doc IDs to the console.
