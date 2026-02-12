Status: Completed

# P1 - Adopt `RevealCard` for Memoria Across Key Views (Event-Driven Only)

## Problem
Memoria’s “premium but quiet” motion currently lands best on Dashboard. Other core portal views (My Pieces, Firings, Check-in, etc.) still feel static or inconsistent.

We want:
- Viewport-triggered reveals (no continuous animations)
- Desktop-only hover/press micro-motion
- Respect both `prefers-reduced-motion` and the user toggle `profiles.uiEnhancedMotion`

## Tasks
- Add a lightweight `EnhancedMotionContext` (or prop) that exposes the computed `portalMotion` state (`enhanced|reduced`) to views.
- Wrap top-level cards/sections in these views with `RevealCard` (only when portalMotion is `enhanced`):
  - `web/src/views/MyPiecesView.tsx`
  - `web/src/views/KilnScheduleView.tsx`
  - `web/src/views/ReservationsView.tsx`
  - `web/src/views/MessagesView.tsx` (only the top-level panels)
- Ensure list rows are not wrapped individually (avoid heavy IO observers). Prefer wrapping groups/sections, not every item.
- Confirm `prefers-reduced-motion` disables reveals/hover motion everywhere.

## Acceptance
- With Memoria theme + Enhanced motion ON:
  - Major sections/cards in the views above reveal on scroll similar to Dashboard.
  - No continuous animations.
- With Enhanced motion OFF (or reduced-motion):
  - No reveal animations; UI is stable and responsive.
- No regression in Portal default theme visuals.

## Progress notes
- `RevealCard` is active in all scoped views with shared gating:
  - `web/src/views/MyPiecesView.tsx`
  - `web/src/views/KilnScheduleView.tsx`
  - `web/src/views/ReservationsView.tsx`
  - `web/src/views/MessagesView.tsx`
- Motion remains conditional on Memoria + enhanced motion:
  - `const motionEnabled = themeName === "memoria" && portalMotion === "enhanced";`
- `RevealCard` itself honors reduced motion and disables IO-based reveals when motion is off:
  - `web/src/components/RevealCard.tsx`
