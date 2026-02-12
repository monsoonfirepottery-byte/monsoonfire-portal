# P1 — Portal A11y: Interactive Semantics and Nested Controls

Status: In Progress

## Problem
- Some interactive areas are implemented as non-semantic containers with `role="button"`.
- At least one row-level interactive container nests a second actionable button.
- This pattern is brittle for keyboard users and assistive technologies.

## Goals
- Use semantic interactive elements consistently.
- Remove nested interactive control conflicts.

## Scope
- `web/src/App.tsx`
- `web/src/views/KilnScheduleView.tsx`
- Other views with similar row-level click handling

## Tasks
1. Replace `div role="button"` controls with semantic `button`/`a` elements.
2. Refactor row interactions to avoid nested interactive descendants:
   - split selection row and action area
   - or make row non-interactive and move actions to explicit controls
3. Ensure keyboard activation parity:
   - Enter/Space behavior where appropriate
4. Add targeted tests for interactive semantics in critical flows.

## Acceptance
- No nested interactive controls in the same activation region.
- Interactive elements expose correct role/name/state by default semantics.
- Keyboard navigation and activation are predictable and consistent.

## Evidence
- `web/src/App.tsx:1365`
- `web/src/views/KilnScheduleView.tsx:408`

## Progress notes
- Refactored `KilnScheduleView` upcoming rows to remove nested interactive controls:
  - removed row-level `role="button"`/keyboard handler wrapping nested buttons
  - added explicit per-row action controls (`View details`, `Add to my calendar`)
- This resolves one concrete nested-interactive pattern while preserving keyboard access.
- Refactored Staff Console Events + Signups tables to remove row-level click handlers and nested interactive conflicts:
  - removed clickable `<tr>` keyboard handlers
  - added explicit first-column `View/Selected` buttons for row selection
  - preserved visual selected state via `.staff-selected-row` without relying on row interactivity
