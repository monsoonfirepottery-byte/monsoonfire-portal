# P1 — Website A11y: Blind / Low-Vision / Screen Reader

Status: In Progress

## Problem
- Blind and low-vision users need reliable semantics, labels, focus order, and contrast.
- Decorative-first layouts can hide structure from assistive tech and make navigation difficult.

## Goals
- Ensure core website journeys are fully screen-reader and keyboard understandable.
- Meet WCAG 2.2 AA contrast and non-text content requirements.

## Scope
- Website global layout, nav, hero, forms, media cards, footer, and CTAs.
- Includes copy semantics and visual contrast tuning.

## Tasks
1. Semantic structure pass:
   - one `h1` per page
   - logical heading hierarchy (`h2`, `h3`)
   - landmark roles (`header`, `nav`, `main`, `footer`)
2. Accessible naming:
   - meaningful `alt` text for content images
   - empty `alt` for decorative images
   - explicit labels for form fields and icon-only buttons
3. Keyboard + focus:
   - visible focus indicators on all interactive controls
   - skip link to main content
   - tab order verification against visual order
4. Contrast and text scaling:
   - verify 4.5:1 body text, 3:1 large text/UI controls
   - support up to 200% zoom without clipping/loss
5. Screen reader QA:
   - NVDA + VoiceOver spot checks on key pages
   - announce form errors and success states properly (`aria-live` where needed)

## Acceptance
- Keyboard-only navigation can complete all primary website actions.
- Screen reader announces page structure, nav items, and form states correctly.
- Contrast checks pass against WCAG 2.2 AA for prioritized pages.
- No critical/serious Axe violations remain on key pages.

## Dependencies
- `tickets/P1-website-a11y-baseline-and-policy.md`

## Progress
- Added global skip-link injection in `website/assets/js/main.js` for pages with `#main`.
- Existing stylesheet already includes `.skip-link` and focus-visible outlines; now activated consistently across pages.
- Support page search now has an explicit accessible label and live-region result count:
  - `website/support/index.html`
- Added reusable visually-hidden utility:
  - `website/assets/css/styles.css`
- FAQ filter/topic toggles now expose `aria-pressed` states:
  - `website/assets/js/faq.js`
- Fixed heading hierarchy on services page by adding a proper page `h1`:
  - `website/services/index.html`
- Added global footer accessibility-link injection so statement is reachable from contact footer blocks:
  - `website/assets/js/main.js`
