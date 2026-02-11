# P1 — Portal A11y: Target Size and Operability

**Status:** Planned

## Problem
- Some controls are smaller than WCAG 2.2 target-size guidance (44x44 CSS px).
- Compact controls increase motor-load and mobile tap errors.

## Goals
- Ensure interactive controls meet minimum target-size and spacing guidance.
- Keep visual density while preserving operability.

## Scope
- Shared app shell styles in `web/src/App.css`
- Small-control patterns in key views (dashboard, chips, icon actions)

## Tasks
1. Audit and normalize minimum target size for:
   - icon buttons
   - compact action buttons
   - filter chips/tags
2. Introduce utility classes/tokens for compact but compliant controls.
3. Validate against mobile viewport layouts to avoid wrap/collision regressions.
4. Document exceptions and rationale where controls cannot be enlarged.

## Acceptance
- Core controls satisfy 44x44 minimum target guidance.
- No loss of functionality due to tap-target collisions on small screens.

## Evidence
- `web/src/App.css:3244`
- `web/src/App.css:683`
- `web/src/App.css:752`
