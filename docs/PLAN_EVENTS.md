# PLAN_EVENTS.md

## Purpose
Plan the Events feature for the Monsoon Fire Portal. Events are single-occurrence experiences (not multi-session classes) with ticketing, waitlist, and fast check-in. Charges are only collected if the attendee checks in.

## Decisions Locked (2026-01-21)
- Single ticket type per event.
- Waitlist enabled with auto-promotion.
- Auto-promotion requires the attendee to claim their spot within 12 hours (via email/push/app).
- Fees collected only if the attendee checks in.
- Add-ons selectable only at check-in, and defined in the event template.
- Stripe checkout is the payment rail.
- All staff can check in attendees.
- Attendee cancellations allowed until 3 hours before event start.

## UX Surfaces
### Attendee
- Events list (card view: date/time, price, includes firing, waitlist status).
- Event detail (description, what is included, low-stress payment policy, add-ons at check-in).
- My Tickets (ticketed, waitlisted, offered, checked-in, cancelled).
- Offer claim flow (tap to secure spot within 12 hours).
- Check-in (self check-in with add-on selection and payment).

### Staff
- Event dashboard (counts: ticketed, waitlisted, offered, checked-in, unpaid).
- Fast check-in list (search by name/email, one-tap check-in).
- "Promote from waitlist" review view (mostly for audit; promotion is automatic).
- Unpaid indicator shown to staff on check-in list.

## Data Model Summary
See `docs/SCHEMA_EVENTS.md` for full schema. Core collections:
- `eventTemplates` -> define default copy, add-ons, and policy strings.
- `events` -> published event instances (snapshot of template fields).
- `eventSignups` -> ticketed + waitlisted + offered + checked-in states.
- `eventCharges` (optional) -> receipts/Stripe records tied to check-in.

## Policies & Copy
### Low-stress payment policy
Place this in event detail and check-in:
- "You won't be charged unless you attend. If plans change, no worries - cancel anytime up to 3 hours before the event."

### Waitlist offer policy
- "A spot opened up. Claim within 12 hours to secure your ticket."

## Key Flows
### 1) Event publish
- Staff creates event from a template.
- Fields from the template are copied into the event for stability (title, description, add-ons, policy copy).
- Event is set to `published`.

### 2) Signup + waitlist
- If capacity available -> create `eventSignups` with `status="ticketed"`.
- If full -> create `eventSignups` with `status="waitlisted"`.
- Signup doc includes displayName/email for fast staff lookup.

### 3) Auto-promotion from waitlist
- When a ticketed attendee cancels, the earliest waitlisted signup is moved to `status="offered"`.
- Set `offerExpiresAt` to 12 hours from promotion.
- Send a push/email with a deep link to claim the spot.
- If `offerExpiresAt` passes without claim -> set `status="expired"` and promote the next waitlist entry.
- Claiming the offer sets `status="ticketed"` and `offeredAt` remains for auditing.
- A scheduled sweep runs every 30 minutes to expire offers and promote the next waitlist entry.

### 4) Cancellation window
- Attendees can cancel their own ticket until 3 hours before `startAt`.
- After cutoff, only staff can cancel (for no-shows or special cases).

### 5) Check-in & payment
- Staff check-in sets `status="checked_in"` and records `checkedInAt`, `checkedInByUid`.
- Attendee self check-in is allowed (no time-window restriction).
- Check-in triggers Stripe Checkout for base ticket + attendee-selected add-ons.
- After successful payment, mark `paymentStatus="paid"` and record charge metadata.
- Staff UI shows `paymentStatus="unpaid"` until payment is complete.

## Stripe / Functions Plan
- `createEventCheckoutSession` (HTTP callable/endpoint):
  - Input: `eventId`, `signupId`, `addOnIds`.
  - Validates: signup belongs to user, status is `checked_in`, paymentStatus is `unpaid`.
  - Returns: checkout URL + troubleshooting metadata.
- `handleEventCheckoutWebhook`:
  - Marks `paymentStatus="paid"`, writes `eventCharges` receipt.
- Troubleshooting: capture last payload/response/status + curl equivalent (same pattern as Materials).

## Security & Access
- Attendees can only read published events.
- Attendees can read their own `eventSignups` and create/cancel until cutoff.
- Staff can read/manage all `eventSignups` and check-ins.
- Staff-only mutations should be routed through Cloud Functions or secure rules.

## Local seeding
- Run `node functions/scripts/seedEvents.js` to create two published sample events.
- The script respects `FIRESTORE_EMULATOR_HOST` and defaults to `127.0.0.1:8080`.

## Open Implementation Notes
- Composite indexes likely needed for:
  - `eventSignups` where `eventId == X` order by `createdAt`.
  - `eventSignups` where `eventId == X` order by `status` then `createdAt`.
- Never write `undefined` into Firestore; omit or use `null`.

## iOS Parity
- Mirror the same collections and status transitions.
- Keep UI logic minimal and data-driven (template + event snapshot).
