# Analytics instrumentation: key events

Status: Completed
Priority: P3
Severity: Sev4
Component: portal
Impact: high
Tags: analytics, telemetry, engagement

## Problem statement
We do not have a single, safe analytics wrapper for key funnel events. Without this, we cannot reliably measure sign-in success, batch actions, or timeline usage, and adding GA later risks scattered call patterns.

## Proposed solution
Add a tiny analytics abstraction (`track`, `identify`) that:
- never crashes if GA/gtag is absent
- logs to console in dev for fast verification
- centralizes payload shape so iOS can mirror one API
- instruments core events for auth, views, and batch operations

## Acceptance criteria
- Wrapper exists under `web/src/lib/analytics.ts` with `track(eventName, props)` and `identify(user)`.
- In dev mode, event calls print to console with timestamp.
- If `window.gtag` is missing, app behavior is unchanged (no throw).
- Required event names are emitted from active call sites:
  - `auth_sign_in_start`, `auth_sign_in_success`, `auth_sign_out`
  - `portal_view_active`, `portal_view_history`
  - `batch_create_test_clicked`, `batch_create_test_success`, `batch_create_test_error`
  - `batch_close_clicked`, `batch_close_success`, `batch_close_error`
  - `continue_journey_clicked`, `continue_journey_success`, `continue_journey_error`
  - `timeline_open`, `timeline_load_success`, `timeline_load_error`

## Manual test checklist
1. Run web app in dev and open browser console.
2. Perform each instrumented action and verify `[analytics]` console entries.
3. Confirm sign-out still works and emits event.
4. Trigger one error path (e.g., invalid admin token) and verify matching `*_error` event.
5. Confirm no runtime errors when `window.gtag` is undefined.

## Notes for iOS parity (SwiftUI portability)
- Mirror wrapper interface in Swift (`track(name:props:)`, `identify(user:)`).
- Preserve event names and normalized fields (`uid`, `batchId`, `atIso`).
- Keep payloads JSON-safe and small to match mobile telemetry transport.

## Completion notes (2026-02-12)
- Added `web/src/lib/analytics.ts` with resilient `track`/`identify` wrapper (dev console logging + optional `window.gtag` pass-through).
- Instrumented required auth, portal view, batch create/close, continue journey, and timeline events in:
  - `web/src/App.tsx`
  - `web/src/views/ReservationsView.tsx`
  - `web/src/views/MyPiecesView.tsx`
