# Monsoon Fire Portal — Release Notes

## v0.1.0 (2026-01-20)
- Branded client shell with mobile drawer navigation and top bar.
- Live "My Pieces" view backed by Firestore (active + history batches).
- Inline timeline viewer per piece with animated expansion.
- Continue journey + archive actions wired to Cloud Functions with in-flight guards.
- Dashboard shows live in-progress pieces and an archived summary card.
- Dev-only admin token input for x-admin-token in the profile section (localStorage persisted).

## v0.1.1 (2026-01-21)
- Kiln Schedule view with kiln status cards, monthly calendar, and firing details.
- Downloadable `.ics` reminders for upcoming kiln firings.
- Mock kiln schedule data + dev-only Firestore seed helper.

## v0.1.2 (2026-01-22)
- Reservations view: kiln slot request form, preferred window fields, and reservation history.
- `createReservation` Cloud Function + new `reservations` collection schema.
- Firestore data + docs updated so the UI streams the client's reservations.

## v0.1.3 (2026-01-22)
- Profile + settings view: account summary, membership stats, and history.
- Editable display name, preferred kilns, and notification toggles.
- Added `profiles/{uid}` schema docs and Firestore-backed updates for studio notes/history.

## v0.1.4 (2026-01-22)
- Events: list + detail + signup/waitlist + staff check-in roster.
- Attendance-only billing flow with check-in and Stripe Checkout support.
- Materials & Supplies catalog with cart, hosted Checkout, and seed scripts for local testing.

## v0.1.5 (2026-01-22)
- UI refresh across Events, Materials, Membership, Support, Profile, Reservations, and Kiln Schedule.
- Shared surface tokens and borders aligned with the updated brand palette.
