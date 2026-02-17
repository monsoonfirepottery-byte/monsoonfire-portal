# S12-02 - Universal Links + Callback Contract (Stripe + Notifications)

Created: 2026-02-10
Sprint: 12
Status: Completed
Swarm: B (Deep Links + Routing)

## Problem

Web uses browser URLs + query params. Native clients require an explicit deep-link contract:
- Universal Links (iOS) / App Links (Android)
- Deterministic routing for:
  - Stripe checkout success/cancel returns
  - notification tap routing

## Tasks

- Define canonical link patterns for:
  - Materials checkout: `/materials?status=success|cancel`
  - Events checkout: `/events?status=success|cancel&eventId=...`
  - Notification routes:
    - `/kiln?firingId=...`
    - `/pieces?batchId=...`
    - `/events?eventId=...`
- Decide hosting location for:
  - iOS AASA file (`/.well-known/apple-app-site-association`)
  - Android assetlinks (`/.well-known/assetlinks.json`)
- Implement minimal router parity:
  - iOS: `ios/DeepLinkRouter.swift`
  - Android: central deep link parser + navigation handler
- Add docs for QA: how to trigger each deep link and expected routing.

## Acceptance

- Stripe return URLs land the user in the correct native screen with a visible success/cancel message.
- Notification taps route to the correct screen, even from cold start.
- Unknown links fail safely (no crash; show a fallback message).

## Progress updates
- Confirmed and documented canonical route patterns and `.well-known` hosting requirements in:
  - `docs/DEEP_LINK_CONTRACT.md`
- Added Android deep-link parser + route model:
  - `android/app/src/main/java/com/monsoonfire/portal/reference/DeepLinkRouter.kt`
- Added Android VIEW intent handling in:
  - `android/app/src/main/java/com/monsoonfire/portal/reference/MainActivity.kt`
- Added Android App Link intent filters for portal/auth hosts:
  - `android/app/src/main/AndroidManifest.xml`
- Added QA trigger commands for iOS/Android deep-link verification in docs.
