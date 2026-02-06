# Sprint 06 - Device Integration + Release Pipeline

Window: Week 6  
Goal: Connect iOS app to device-level notification delivery and establish repeatable Apple build/release verification.

## Ticket S6-01
- Title: APNs device token backend registration endpoint
- Swarm: `Swarm A`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S5-05
- Deliverables:
  - Cloud Function endpoint to register APNs device tokens
  - Firestore mapping: `uid -> [deviceTokens]` with platform metadata
  - auth enforcement on token registration calls
- Verification:
1. Authenticated token registration succeeds and persists expected fields.
2. Duplicate token registration is idempotent.
3. Unauthenticated call fails with explicit auth error.

## Ticket S6-02
- Title: iOS device token submit wiring + retry
- Swarm: `Swarm A`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S6-01, S5-05
- Deliverables:
  - submit captured APNs token from iOS to backend endpoint
  - retry and offline-safe queueing for token submit
  - visible status in shell/debug pane
- Verification:
1. Token submit call reaches backend and stores mapping.
2. Offline submit retries without duplicate token writes.
3. Shell shows clear success/error status.

## Ticket S6-03
- Title: Notification routing model (member/staff segments)
- Swarm: `Swarm C`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S6-01
- Deliverables:
  - segment strategy for staff/member targeted notifications
  - backend helper for recipient selection
  - docs for routing rules and fallback behavior
- Verification:
1. Member-targeted notification excludes staff-only users.
2. Staff-targeted notification excludes member-only users.
3. Routing fallback handles missing token records gracefully.

## Ticket S6-04
- Title: iOS deep-link handling for checkout/event callbacks
- Swarm: `Swarm B`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S3-03, S3-04
- Deliverables:
  - deep-link parser for `status=success|cancel` flows
  - route to relevant iOS screen/state with user-visible confirmation
  - shared deep-link runbook entries
- Verification:
1. Success callback routes and updates status message correctly.
2. Cancel callback routes and preserves user context.
3. Unknown links fail safely with non-crashing message.

## Ticket S6-05
- Title: macOS CI pipeline for iOS build + smoke checks
- Swarm: `Swarm D`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S4-04, S5-04
- Deliverables:
  - GitHub Actions macOS workflow for iOS compile and smoke checks
  - artifact/report output for alpha verification evidence
  - failure classification and escalation notes
- Verification:
1. CI runs iOS build on macOS and reports pass/fail.
2. Smoke script output is captured as CI artifact.
3. Pipeline failures include actionable logs.
