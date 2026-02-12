Status: Completed

# P1 - QA: Enhanced Motion Toggle (Memoria)

## Problem
We introduced an Enhanced motion user setting (`profiles.uiEnhancedMotion` + `localStorage mf:enhancedMotion`) and device heuristics. We need confidence it behaves predictably across devices/browsers and doesn’t accidentally re-enable heavy motion.

## Tasks
- Verify precedence rules:
  - First run: device heuristic default applies.
  - User change persists to localStorage.
  - Signed-in users load `profiles.uiEnhancedMotion` and override localStorage.
- Validate computed DOM state:
  - `html[data-portal-motion="enhanced|reduced"]` matches expectations.
  - `html[data-portal-theme="portal|memoria"]` still correct.
- Manual QA matrix (at least):
  - Desktop Chrome (Windows)
  - Mobile Safari (iOS) or iOS simulator
  - `prefers-reduced-motion: reduce` enabled/disabled
  - Narrow viewport (<=720px) default behavior
- Confirm Firestore rules allow writing `uiEnhancedMotion`.
- Ensure Profile UI copy is clear and doesn’t fight `prefers-reduced-motion`.

## Acceptance
- No white screens, no console errors.
- Toggle updates motion behavior immediately (no refresh needed).
- Setting persists across reload and (when signed in) across devices via Firestore.

## Progress notes
- Added motion preference helper coverage:
  - `web/src/theme/motionPreference.ts`
  - `web/src/theme/motionPreference.test.ts`
- Added QA runbook and matrix:
  - `docs/MEMORIA_ENHANCED_MOTION_QA.md`
- Confirmed Firestore rule support for `profiles.uiEnhancedMotion`:
  - `firestore.rules` allows `bool | null`.
- Known environment note captured in QA doc:
  - iOS simulator validation deferred until Xcode tooling is available.
