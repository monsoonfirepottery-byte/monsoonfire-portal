# Sprint 12 - Mobile Translation Risk Register (Web -> iOS/Android)

Date: 2026-02-10  
Status: In progress

## Goal

Identify and de-risk the "unknown unknowns" that will slow down a web-to-native translation, before we commit to iOS/Android feature parity sprints.

This sprint is intentionally heavy on decisions, runbooks, and environment wiring. It should reduce churn and surprise work once native UI implementation begins.

## Non-negotiables

- Stateless JSON contracts remain canonical in `web/src/api/portalContracts.ts`.
- All protected Cloud Functions require `Authorization: Bearer <idToken>`.
- Firestore never receives `undefined` fields (omit or `null` only).
- Portal production origin is `https://portal.monsoonfire.com` (no `www.portal.*`).

## Risk Register (Unknown Unknowns)

1. Auth provider requirements differ by platform and hosting
- Web popup auth is not a mobile-native primitive.
- Apple/Facebook/Microsoft require provider console setup (client IDs/secrets) and exact redirect URI alignment.
- Web Apple sign-in can require an auth handler domain you control (not just `*.firebaseapp.com`), which conflicts with a portal hosted purely on Namecheap without Firebase Hosting involvement.

2. Deep links and callbacks are different on web vs native
- Web uses query params and browser navigation.
- Native must support universal links / app links (Associated Domains, AASA files, URL schemes).
- Stripe checkout success/cancel return flows need a defined deep-link strategy for iOS/Android.

3. Push notifications and background execution are constrained on phones
- APNs/FCM token lifecycle, invalidation, refresh, and re-registration flows.
- App killed/background: notification delivery and tap-routing needs explicit design.
- Metrics/telemetry must tolerate intermittent connectivity and delayed uploads.

4. Offline mode is the default, not the exception
- Native clients need explicit retry queues for all write-capable actions.
- Firestore offline persistence differs from browser behavior, and conflict resolution needs product decisions.

5. Security posture is stricter in production mobile clients
- Token storage: Keychain/Keystore, not localStorage/sessionStorage.
- Staff claim changes require token refresh logic and role-aware gating parity.
- App attestation and abuse control may become necessary once native installs scale.

6. Build/test infrastructure is a gating factor
- iOS compilation, signing, and runtime verification require macOS + Xcode.
- A CI strategy is needed for iOS builds and smoke tests.

## Progress (2026-02-10)

- S12-01 (Auth domain strategy): implemented code support + runbook
  - `web/src/firebase.ts` now supports `VITE_AUTH_DOMAIN`
  - Runbook: `docs/AUTH_DOMAIN_SETUP.md`
- S12-02 (Deep link contract): documented and added `.well-known` templates
  - Contract: `docs/DEEP_LINK_CONTRACT.md`
  - Templates: `website/.well-known/apple-app-site-association`, `website/.well-known/assetlinks.json`
- S12-06 (iOS build gate, B-tier): added Swift Package + CI build
  - `ios-gate/`
  - `.github/workflows/ios-build-gate.yml`

## Tickets

### S12-01 - Portal Auth Domain Strategy (Apple + Multi-provider)
- Decide: do we introduce a Firebase Hosting auth handler domain (e.g. `auth.monsoonfire.com`) while the portal stays on Namecheap.
- Output: decision + required DNS + Firebase console steps.
- Acceptance: Apple/Microsoft/Facebook providers have a stable redirect URI on a domain we control.

### S12-02 - Universal Links + Callback Contract
- Define canonical deep links for:
  - checkout status callbacks (`/materials?status=success|cancel`)
  - events payment callbacks
  - notifications tap routing (firing id, batch id, event id)
- Output: doc + minimal router implementations in iOS/Android shells.
- Acceptance: callbacks route deterministically with a single source-of-truth mapping.

### S12-03 - Push Lifecycle Spec + Telemetry
- Define token registration/unregistration behavior and failure handling.
- Define what gets written to `notificationDeliveryAttempts` and when.
- Acceptance: reliable retry behavior and an on-call runbook that maps to native behavior.

### S12-04 - Offline/Retry Policy (Member + Staff Actions)
- Specify which writes are:
  - "must be online" (blocking)
  - "queueable" (retry with idempotency keys)
- Output: policy doc + client-side queue helper parity requirements.

### S12-05 - Mobile Secure Storage + Session Model
- Define token storage mechanism and rotation.
- Define how staff claim refresh is handled (and how UI updates).
- Acceptance: no tokens in logs; predictable sign-out and refresh behavior.

### S12-06 - iOS/macOS Build Gate
- Define a macOS runner strategy for iOS compilation + basic smoke tests.
- Acceptance: CI fails fast on iOS compile regressions and produces actionable logs.

## Suggested Swarm Allocation

- `Swarm A` (Auth + Security): S12-01, S12-05
- `Swarm B` (Deep Links + Routing): S12-02
- `Swarm C` (Push + Telemetry): S12-03
- `Swarm D` (QA + CI): S12-04, S12-06
