# Website Accessibility Baseline (MonsoonFire.com)

## Target
- Standard: **WCAG 2.2 AA**
- Scope: `website/` marketing site pages and shared assets.

## Release Gate (minimum)
- Keyboard-only pass on core pages:
  - `/`
  - `/services/`
  - `/kiln-firing/`
  - `/memberships/`
  - `/support/`
- No critical accessibility blockers for:
  - focus visibility
  - missing form labels
  - major contrast failures on body/CTA text
- Accessibility statement is published and linked.

## Automated Checks
- Lighthouse accessibility audit in CI for key pages.
- Track regressions release-over-release (do not allow accessibility score to drop without explicit sign-off).

## Manual QA Matrix
- Desktop: keyboard-only navigation, zoom 200%, reduced-motion enabled.
- Mobile: iOS Safari + Android Chrome checks for tap targets and readable hierarchy.
- Screen reader spot checks:
  - VoiceOver (macOS or iOS)
  - NVDA (Windows)

## Content Rules
- Every meaningful image needs descriptive `alt`.
- Decorative images must use empty `alt=""`.
- Audio/video with speech must include captions; long-form content should include transcript access.
- No critical information can be conveyed by color-only or audio-only cues.
- Media publishing checklist: `docs/WEBSITE_MEDIA_ACCESSIBILITY_CHECKLIST.md`.

## Reporting + Triage
- Public accessibility contact: `support@monsoonfire.com`.
- User reports are tagged `a11y` and prioritized by impact:
  - `critical`: blocks task completion
  - `major`: significant friction
  - `minor`: quality/usability improvements

## Ownership
- Website owner is responsible for accessibility sign-off before publish.
- Any exception to WCAG 2.2 AA requires a documented rationale and follow-up ticket.
