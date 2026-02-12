# P1 — Website A11y: Motor, Cognitive, and Neurodiverse Users

Status: In Progress

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

## Progress
- Increased interactive target sizing and spacing in shared website controls:
  - `website/assets/css/styles.css`
  - Applied `min-height: 44px` pass across primary buttons, nav links, menu toggle, filter chips, tags, accordion triggers, and form inputs.
- Expanded focus visibility coverage to form controls:
  - `website/assets/css/styles.css`
  - Added `:focus-visible` outline support for `input`, `textarea`, and `select`.
- Added reusable form helper/error text styles for explicit, persistent validation messages:
  - `website/assets/css/styles.css`
- Reduced-motion improvements in interactive modules:
  - `website/assets/js/main.js`
  - `website/assets/js/faq.js`
  - Auto-rotate and smooth scrolling now respect `prefers-reduced-motion`.
- Improved accordion state clarity for assistive tech and keyboard users:
  - `website/assets/js/faq.js`
  - Added `aria-expanded` state updates on accordion toggles.
