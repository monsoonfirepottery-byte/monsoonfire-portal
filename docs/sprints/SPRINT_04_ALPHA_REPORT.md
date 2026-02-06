# Sprint 04 Alpha Report

Date: 2026-02-05  
Sprint: `docs/sprints/SPRINT_04_HARDENING_ALPHA.md`  
Status: `ready_for_verification`

## Scope Completed in This Pass
- Added iOS shell performance instrumentation:
  - cold-start elapsed metric (`ms`)
  - last smoke-test duration (`ms`)
  - retry-used indicator
- Added iOS offline awareness:
  - network monitor status (`Online` / `Offline`)
  - explicit offline notice in shell
  - network-dependent smoke action disabled while offline
- Added safe retry behavior for network-sensitive smoke action:
  - bounded retry (`maxAttempts = 2`)
  - retry on network-like failures only
  - existing in-flight guard remains in place to avoid duplicate submits
- Added baseline accessibility improvements on critical shell action:
  - explicit accessibility label for smoke test action
  - readable status/performance text blocks

## Files Added
- `ios/NetworkMonitor.swift`
- `ios/AppPerformanceTracker.swift`
- `ios/RetryExecutor.swift`

## Files Updated
- `ios/PortalAppShell.swift`
- `docs/sprints/SPRINT_04_HARDENING_ALPHA.md`

## Verification Notes
1. `S4-01` Performance pass:
   - Instrumentation values are now exposed in shell UI (`cold start`, `last smoke duration`).
   - Baseline recording path is implemented.
2. `S4-02` Retry/offline behavior:
   - Offline state surfaced and action gating applied.
   - Retry logic executes only on network-like failures and remains bounded.
3. `S4-03` Accessibility pass:
   - Core shell action is labeled and status sections remain text-first for assistive tech.
4. `S4-04` Alpha gate report:
   - This document serves as the alpha checklist execution artifact.

## Known Gaps / Blockers
- Full iOS compile/runtime verification is blocked on this Windows environment.
- VoiceOver and large Dynamic Type walkthrough require macOS + iOS Simulator (or physical iPhone).
- Cold start/hot navigation timing should be captured on a macOS-run instrumented build for final sign-off.

## Sign-off Inputs Needed
- Sprint Manager review on alpha gate checklist.
- Verifier pass on:
  - iOS Simulator runtime checks
  - VoiceOver walkthrough
  - Dynamic Type (large accessibility sizes)
  - smoke action retry/offline behavior under controlled network conditions

## TODOs (macOS Verification)
- [ ] Build iOS app in Xcode (`Debug`) on macOS and record pass/fail.
- [ ] Run iOS Simulator smoke pass for shell + all navigation entries.
- [ ] Run VoiceOver walkthrough on core flows (Reservations, Events, Materials, Billing).
- [ ] Run Dynamic Type pass at large accessibility sizes and capture layout issues.
- [ ] Capture cold-start and hot-navigation timings from instrumented shell.
- [ ] Re-run offline + retry behavior checks on real Apple runtime.
- [ ] Produce final verifier sign-off note and mark Sprint 04 tickets `done`.
