# P2 — Website Contact Page Conversion Intake

Status: Completed
Priority: P2
Severity: Sev3
Component: website
Impact: med
Tags: website, conversion, contact

## Problem statement
`/contact/` is clear but minimal, and relies primarily on email/portal login. For first-time prospects, this adds friction and reduces immediate conversion.

## Proposed solution
- Add a lightweight contact intake form with intent options (for example: kiln firing, membership, studio access, general question).
- Keep email option, but make form the primary path for unknown/new visitors.
- Add response-time expectation text and confirmation UX.

## Acceptance criteria
- Contact page includes a visible intake form with required core fields.
- Form submission path is operational (or clearly routes to safe fallback).
- User sees success confirmation with expected reply window.
- Email and portal login remain available as secondary actions.

## Manual test checklist
1. Submit valid and invalid form entries.
2. Confirm required-field validation and error states are clear.
3. Confirm success message appears and includes expected response timing.
4. Confirm email and portal links still work.

## Dependencies
- `tickets/P1-website-a11y-baseline-and-policy.md`
- `tickets/P3-website-polish-conversion-trust.md`

## Completion notes (2026-02-17)
- Added a lightweight new-visitor intake form on `website/contact/index.html` with:
  - required core fields (name, email, request type, project details)
  - optional timeline field
  - clear validation error messaging and invalid-field highlighting
- Added fallback submission path that drafts an email to `support@monsoonfire.com` with the submitted intake details.
- Added confirmation messaging after submit with response-time expectations:
  - "Typical reply window: 1 business day."
- Kept email and portal entry points visible as secondary actions.
