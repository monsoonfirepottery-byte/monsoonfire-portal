Status: Completed

# P2 - Motion Performance Guardrails (Auto-Downgrade)

## Problem
Even event-driven motion can feel “heavy” on some devices. We want a safety rail that automatically disables Enhanced motion if the runtime is struggling, while keeping the app stable and debuggable.

## Tasks
- Add a lightweight runtime detector (Memoria-only, enhanced-motion only):
  - Track a short rAF window during initial interactions and estimate if frames are consistently slow.
  - If consistently slow, set portal motion to reduced and persist `mf:enhancedMotion=0`.
- Add a small in-app notice (non-blocking) explaining motion was reduced for performance.
- Ensure this logic never runs if `prefers-reduced-motion` is on.

## Acceptance
- On a stressed laptop, the portal self-downgrades motion without breaking navigation.
- No continuous background work once downgraded.
- No new dependencies.

## Progress notes
- Implemented runtime probe in `web/src/App.tsx` (Memoria + enhanced motion only):
  - Arms on first interaction (`pointerdown` / `keydown` / `scroll`, once).
  - Samples ~50 rAF frames and computes `avg` + `p95`.
  - Auto-downgrades when frame timings exceed thresholds (`avg > 24ms` or `p95 > 34ms`).
- Downgrade behavior:
  - Sets `enhancedMotion=false` in app state.
  - Persists `mf:enhancedMotion=0` via `writeStoredEnhancedMotion(false)`.
  - Best-effort profile sync: writes `profiles/{uid}.uiEnhancedMotion=false` for signed-in users.
- User feedback:
  - Added non-blocking notice: `Enhanced motion was disabled for performance. You can re-enable it in Profile.`
- Guardrails:
  - Probe is skipped when `prefers-reduced-motion` is enabled.
  - No continuous detector loop after the one-time probe completes.
