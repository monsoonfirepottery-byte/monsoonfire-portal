# iOS Migration Plan (Swift/SwiftUI)

Date: 2026-02-05  
Owner: TBD  
Status: Draft (execution-ready)

## Scope
- Build a production iOS client that reaches feature parity with the hardened web portal.
- Reuse existing Firebase Auth, Firestore reads, and Cloud Functions HTTP contracts.
- Keep `web/src/api/portalContracts.ts` as canonical API shape source while mirroring in Swift.

## Architecture Targets
- App framework: SwiftUI + async/await.
- Networking: `PortalApiClient.swift` parity with web `functionsClient` behavior.
- Auth: Firebase Auth with provider + email flows.
- Data: Firestore queries for read-heavy surfaces; Functions for write/transactional flows.
- Observability: request metadata + curl-style debug equivalents + client-side handler error log parity.

## Phased Delivery

### Phase 0: Foundations (1 sprint)
- Confirm `ios/PortalContracts.swift` coverage matches current `portalContracts.ts`.
- Confirm `PortalApiClient.swift` supports:
  - `Authorization: Bearer <idToken>`
  - dev admin token header flow
  - request/response metadata capture
  - normalized error envelope handling
- Add iOS local debug log parity for handler/network failures.
- Add feature flags for staged screen rollout.

### Phase 1: Auth + Shell + Navigation (1 sprint)
- Implement signed-out flows:
  - provider sign-in
  - email/password
  - email-link completion
- Build app shell/tab structure mirroring key web navigation groups.
- Add top-level error boundary equivalents (global alert/toast + fallback view).

### Phase 2: Core Studio Flow (2 sprints)
- Implement Reservations (check-in workflow):
  - form parity
  - photo upload
  - submit via `createReservation`
  - troubleshooting/debug capture
- Implement My Pieces read flow and critical actions used by members.
- Implement kiln schedule read + unload action parity for staff paths.

### Phase 3: Commerce + Events (2 sprints)
- Implement Events attendee flow + staff roster actions.
- Implement Materials catalog/cart + checkout session start.
- Add deep-link handling for checkout status callbacks.
- Implement Billing summary parity (event charges + material orders).

### Phase 4: Hardening + Alpha Exit (1 sprint)
- Performance pass on launch/list/detail paths.
- Offline and retry behavior review for critical actions.
- Accessibility pass (dynamic type, VoiceOver, focus order).
- Beta telemetry and crash monitoring hooks.

## Contract Governance
- Update flow for backend contract changes:
1. Update `web/src/api/portalContracts.ts`.
2. Mirror in `ios/PortalContracts.swift`.
3. Update `docs/API_CONTRACTS.md` if endpoint behavior changes.
- Keep optional/null semantics strict (`undefined` never represented; omit or `null` only).

## Parity Acceptance Gates (Alpha)
- Auth flows work end-to-end in production Firebase project.
- Reservations submit + photo upload + debug metadata operational.
- Events and Materials checkout handoff operational.
- Billing summary data visible and accurate.
- No lint/type errors and no crashing blocker in primary flows.

## Risks and Mitigations
- Contract drift risk:
  - Mitigation: required contract mirror checklist on every backend PR.
- Firestore query/index differences:
  - Mitigation: capture index needs during iOS QA and maintain index checklist.
- Async error invisibility:
  - Mitigation: use centralized handler wrappers + structured local log.
