# Pricing + Community Shelf QA Loop

Last updated: 2026-02-26

## Scope
- Portal reservation/check-in flow (non-staff and staff-assisted)
- Cloud Functions reservation create/check-in/update paths
- Scheduling/queue behavior for `COMMUNITY_SHELF`
- Website pricing/policy copy

## Test Data Plan
- Account A (member): normal user with no staff claims.
- Account B (staff): staff role + admin token available in portal localStorage.
- Reservation fixtures:
  - `SHELF_PURCHASE` bisque reservation with 2 half shelves.
  - `WHOLE_KILN` glaze reservation.
  - `COMMUNITY_SHELF` reservation with `estimatedCost=0`.
- Message/notification fixture:
  - At least one unread notification for mark-read flow.
- Theme coverage:
  - Run all UI checks once in light theme and once in dark theme.

## Manual QA Checklist
- [ ] Sign in as Account A and verify reservation page loads without runtime errors.
- [ ] Sign in as Account B, paste admin token, and verify staff tools render.
- [ ] Submit `SHELF_PURCHASE` reservation and verify success status.
- [ ] Submit `WHOLE_KILN` reservation and verify success status.
- [ ] Start `COMMUNITY_SHELF` selection and verify policy popup appears first.
- [ ] Continue from popup and verify second confirmation modal appears.
- [ ] Click `Cancel` in either modal and verify prior intake mode is restored.
- [ ] Confirm `COMMUNITY_SHELF` and submit; verify submission succeeds.
- [ ] Verify double-clicking submit does not create duplicate reservations.
- [ ] Verify reservation list renders without permission/runtime errors.
- [ ] Verify `continueJourney` still works with body `{ uid, fromBatchId }` + bearer token.
- [ ] Verify notifications mark-read succeeds and updates UI feedback.
- [ ] Verify mark-read failure (`Missing or insufficient permissions`) is surfaced clearly when forced.

## Backend/API Checks
- [ ] `createReservation` accepts canonical intake modes and does not require volume fields.
- [ ] `apiV1/v1/reservations.create` accepts canonical intake modes and writes successfully.
- [ ] `COMMUNITY_SHELF` reservations persist `estimatedCost` as `0`.
- [ ] Legacy docs with old/extra fields still read without crashes.
- [ ] `assignStation` capacity checks ignore `COMMUNITY_SHELF` reservations.

## Scheduling + Queue Checks
- [ ] Queue ordering places `COMMUNITY_SHELF` after paid reservations.
- [ ] Kiln board active queue/capacity counts exclude `COMMUNITY_SHELF`.
- [ ] Kiln launch UI firing meter excludes `COMMUNITY_SHELF` from threshold/planning totals.

## Content Checks
- [ ] `website/kiln-firing` and `website/ncsitebuilder/kiln-firing` show per-shelf + whole-kiln pricing only.
- [ ] Website copy explicitly states billing is not based on kiln volume.
- [ ] Website copy explains community shelf is free, lowest priority, and excluded from firing triggers.
- [ ] Repo grep for `by volume`, `useVolumePricing`, `volumeIn3`, `per cubic inch` returns no billing-path matches.

## Automation Targets
- `npm --prefix web run test:run -- src/lib/pricing.test.ts src/lib/intakeMode.test.ts src/views/ReservationsView.test.ts src/views/NotificationsView.test.ts`
- `npm --prefix functions run test -- apiV1.test.ts intakeMode.test.ts continueJourneyContract.test.ts`
- `npm run portal:notifications:authz:check`
- `node ./scripts/run-portal-virtual-staff-regression.mjs --skip-ui-smoke --json`
