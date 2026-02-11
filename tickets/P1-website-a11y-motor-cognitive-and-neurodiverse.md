# P1 — Website A11y: Motor, Cognitive, and Neurodiverse Users

**Status:** Planned

## Problem
- Small targets, animation-heavy UI, and dense copy create barriers for users with motor and cognitive differences.
- Time pressure and inconsistent interaction patterns reduce completion rates.

## Goals
- Improve operability, readability, and predictability of website interactions.
- Reduce motion/cognitive overload while preserving brand quality.

## Scope
- Website navigation, CTA blocks, forms, pricing/plan sections, and interactive modules.

## Tasks
1. Target size + spacing:
   - ensure interactive controls meet minimum target size guidance (~44x44 CSS px where applicable)
   - increase spacing between adjacent controls to prevent accidental activation
2. Motion controls:
   - respect `prefers-reduced-motion`
   - disable non-essential parallax/auto-animations in reduced mode
3. Form usability:
   - explicit error messages near fields
   - preserve entered values on validation errors
   - avoid timeout-dependent interactions
4. Content clarity:
   - simplify sentence structure in critical sections
   - add clear section labels and concise CTA text
5. Keyboard operability:
   - all controls reachable and actionable without pointer input

## Acceptance
- Core interactions are fully keyboard-operable.
- Reduced-motion mode removes non-essential animations/transitions.
- Form errors are clear, persistent, and actionable.
- Interactive controls meet target-size and spacing requirements on mobile + desktop.

## Dependencies
- `tickets/P1-website-a11y-baseline-and-policy.md`

