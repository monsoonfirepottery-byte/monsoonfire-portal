# Portal Accessibility Baseline (Monsoon Fire Portal)

## Target
- Standard: **WCAG 2.2 AA**
- Scope: authenticated app shell + signed-out flow under `web/src`.

## Priority user journeys
1. Sign in/out and profile access.
2. Dashboard navigation and primary action chips.
3. Kiln rentals flow (check-in, queues, firings).
4. Community reporting flow and moderation receipts.
5. Staff console critical operations (reports, events, agent ops).

## Release gate (minimum)
- Keyboard-only pass on core portal routes:
  - Dashboard
  - Kiln Rentals overview + check-in
  - Community
  - Profile
  - Staff (for staff users)
- No critical a11y regressions in:
  - focus visibility
  - form labeling
  - live-region status/error messaging
  - nested interactive controls
  - tap-target sizing for compact controls
- Reduced motion behavior verified on key animated surfaces when OS prefers-reduced-motion is enabled.

## Manual QA matrix
- Desktop:
  - Keyboard-only navigation and operation
  - Zoom to 200% without clipping/truncation of core controls
  - Reduced-motion system setting
- Mobile:
  - iOS Safari and Android Chrome tap-target and readability checks
- Screen reader spot checks:
  - VoiceOver (iOS/macOS)
  - NVDA (Windows)

## Existing guardrails in portal code
- Top-level `ErrorBoundary` around app shell.
- Skip link to `#main-content`.
- Keyboard-focus tooltip visibility for collapsed nav labels.
- Semantic control refactors in high-traffic views (no row-level nested interactive patterns).
- Live-region support for async status/error in key forms and integrations.

## CI + verification expectations
- Keep `npm --prefix web run build` and route test suites green.
- Add/maintain targeted tests for interaction semantics in changed views.
- Accessibility regressions discovered during release prep require either:
  - fix before release, or
  - explicit waiver with follow-up ticket and owner.

## Triage conventions
- Label/tag: `a11y-portal`.
- Severity:
  - `critical`: blocks task completion or causes severe AT failure
  - `major`: high friction in primary flows
  - `minor`: quality improvement with workaround
- Required fields on ticket:
  - affected route/view
  - reproduction steps (keyboard + AT if relevant)
  - expected vs observed
  - impact statement

## Ownership
- Feature owner is responsible for accessibility sign-off on changed routes.
- Staff-facing route changes require explicit keyboard + focus review.
- Exceptions to WCAG 2.2 AA require documented rationale and a remediation date.
