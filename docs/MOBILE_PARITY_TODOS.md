# Mobile Parity TODOs (iOS + Android)

Date: 2026-01-21
Owner: TBD
Status: In progress

## Goals
- Ship consistent behavior across web, iOS, and Android clients.
- Keep API contracts canonical in `web/src/api/portalContracts.ts` and mirror them in native clients.
- Normalize timeline event types so UI and native labels stay consistent.
- Require Firebase ID tokens on all HTTP Cloud Functions.

## Completed
- [x] Decide Android repo location: this repo under `android/`.
- [x] Hand-sync Kotlin contracts from `web/src/api/portalContracts.ts`.
- [x] Make `ios/PortalContracts.swift` the canonical Swift mirror of `portalContracts.ts`.
- [x] Normalize timeline events across Functions + web + iOS (single enum + labels).
- [x] Enforce Firebase ID token validation on every HTTP function (including admin + debug endpoints).
- [x] Add Android network client parity with `PortalApiClient.swift` (meta, curl examples, error envelope).
- [x] Update API docs to call out the canonical contract and native sync strategy.
- [x] Add a migration plan for legacy timeline events already stored in Firestore.
- [x] Mirror Events contracts in iOS and Android (list/get/signup/cancel/check-in/checkout session).
- [x] Mirror materials + events contract shapes from `web/src/api/portalContracts.ts` into `ios/PortalContracts.swift` and `android/.../PortalContracts.kt` so native clients share the same request/response types.

## Next up
- [ ] Implement Events UI parity (attendee + staff roster) in iOS and Android.
- [ ] Implement Materials/Supplies catalog + cart + Stripe Checkout on iOS.
- [ ] Implement Materials/Supplies catalog + cart + Stripe Checkout on Android.
- [ ] Mirror materials contracts (`MaterialProduct`, checkout request/response) in iOS + Android.
- [ ] Add deep-link handling for `/materials?status=success|cancel` in native clients.
- [ ] Add Billing summary parity (materials orders + event charges).

## Decisions
- Auto-generation of Swift/Kotlin is deferred. Manual sync is the current source-of-truth workflow.

## Notes
- Firestore rejects `undefined`; omit fields or use `null` in all platforms.
- Keep Android + iOS helpers in sync with `portalContracts.ts` for contract changes.
