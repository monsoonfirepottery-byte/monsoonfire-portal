# P1 — Portal A11y: Forms, Filters, and Status Semantics

Status: Planned

## Problem
- Some form/search controls rely on placeholder text instead of explicit labels.
- Filter chips expose visual state only.
- Async status/error messages are not consistently announced to assistive tech.

## Goals
- Ensure all user inputs and dynamic states are programmatically clear.
- Ensure key auth/support feedback is announced without focus-jumping.

## Scope
- `web/src/views/SupportView.tsx`
- `web/src/views/SignedOutView.tsx`
- shared status/alert patterns in portal views

## Tasks
1. Add explicit labels for search and filter inputs where missing.
2. Add proper state attributes for toggle/filter controls:
   - `aria-pressed` for chip-style toggle buttons
3. Add live-region semantics for async feedback:
   - auth status
   - support form status/errors
4. Standardize error + notice semantics:
   - `role="alert"` for blocking/errors
   - `role="status"` / `aria-live="polite"` for non-blocking updates
5. Add helper utilities/components to avoid repeated one-off patterns.

## Acceptance
- Search/filter controls have explicit accessible names.
- Filter state changes are announced correctly.
- Auth/support status updates are announced to screen readers.

## Evidence
- `web/src/views/SupportView.tsx:277`
- `web/src/views/SupportView.tsx:287`
- `web/src/views/SignedOutView.tsx:214`
