Status: Open (2026-02-10)

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

