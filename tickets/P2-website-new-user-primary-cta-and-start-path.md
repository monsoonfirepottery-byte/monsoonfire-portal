# P2 — Website New-User Primary CTA + Start Path

Status: Completed
Priority: P2
Severity: Sev2
Component: website
Impact: high
Tags: website, conversion, onboarding

## Problem statement
First-time visitors can understand the brand and studio type, but the immediate next step is not consistently explicit across pages. The strongest top-nav affordance is often `Login`, which does not serve brand-new users.

## Proposed solution
Define and ship one persistent, first-time-user primary action across high-traffic pages:
- Add a consistent primary CTA label such as `Get started` or `Book first firing`.
- Keep `Login` available but secondary in visual hierarchy for non-auth pages.
- Route new-user CTA to clear branching options (for example: kiln request, studio access, membership).

## Acceptance criteria
- Homepage, services, kiln-firing, memberships, and contact pages show one clear primary new-user CTA above the fold.
- Primary CTA copy is consistent and plain-language.
- `Login` remains visible but does not visually compete with first-time onboarding CTA.
- CTA destination explains next steps in less than 15 seconds of reading.

## Manual test checklist
1. Open each target page in desktop and mobile viewport.
2. Confirm one clear first-time CTA is visible without scrolling.
3. Confirm CTA labels and destination are consistent and understandable.
4. Confirm returning users can still find `Login` quickly.

## Dependencies
- `tickets/P3-website-polish-conversion-trust.md`

## Notes
- Use existing visual language; do not introduce new design system primitives unless needed.

## Completion notes (2026-02-17)
- Shipped consistent first-time primary CTA (`Get started`) on:
  - `website/index.html`
  - `website/services/index.html`
  - `website/kiln-firing/index.html`
  - `website/memberships/index.html`
  - `website/contact/index.html`
- Demoted header `Login` visual prominence on the same pages (kept visible as secondary action).
- Captured Playwright smoke screenshots for desktop and mobile viewport:
  - `output/playwright/cta-pass-home-desktop.png`
  - `output/playwright/cta-pass-services-desktop.png`
  - `output/playwright/cta-pass-kiln-desktop.png`
  - `output/playwright/cta-pass-memberships-desktop.png`
  - `output/playwright/cta-pass-contact-desktop.png`
  - `output/playwright/cta-pass-home-mobile.png`
  - `output/playwright/cta-pass-services-mobile.png`
  - `output/playwright/cta-pass-kiln-mobile.png`
  - `output/playwright/cta-pass-memberships-mobile.png`
  - `output/playwright/cta-pass-contact-mobile.png`
