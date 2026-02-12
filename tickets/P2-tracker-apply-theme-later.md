# P2: Apply New Theme to Tracker UI (Deferred)

Status: Completed
Priority: P2
Severity: Sev3
Component: portal
Impact: med
Tags: tracker, theme, followup

## Goal
Apply the approved Monsoon Fire portal theme and motion language to the internal Tracker experience (`/tracker`, `/tracker/board`) after MVP stability is verified.

## Scope
- Align typography, spacing, tokens, and component states with the current portal visual language.
- Keep troubleshooting panel readability and copy/debug affordances as first-class UX.
- Preserve mobile usability and no-jank interactions.

## Constraints
- Do not reduce tracker reliability instrumentation.
- No regressions in ticket creation, status changes, filters, or GitHub sync flows.

## Acceptance Criteria
- Tracker shell and board feel visually consistent with the latest portal theme system.
- Empty states, form states, and error states remain explicit and legible.
- Existing functionality remains unchanged except visual polish.

## Completion Notes (2026-02-12)
- Tracker routes (`/tracker`, `/tracker/board`) are running on the Memoria token system via `tracker-theme-memoria`.
- Dark theme styling parity is in place for shell, cards, buttons, form states, error states, and troubleshooting diagnostics blocks.
- Functional behavior (ticket CRUD, status transitions, filters, GitHub metadata sync, seed flow) remains unchanged.
