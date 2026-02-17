# Portal Accessibility Regression Guardrails

## Automated Cadence
- CI smoke checks run on:
  - every PR
  - every push to `main`
  - weekly schedule (Mondays, 15:00 UTC)
- Command:
  - `npm --prefix web run a11y:smoke`
- Current smoke coverage:
  - skip link + main landmark
  - mobile nav semantics (`aria-controls`, `aria-expanded`)
  - critical route presence for:
    - signed-out auth
    - dashboard
    - ware check-in (`kilnLaunch`)
    - firings (`kiln`)
    - support
    - staff shell
  - community report/appeal live-region semantics

## Manual Monthly Pass
- Keyboard-only traversal:
  - dashboard, ware check-in, firings, support, staff
- Screen reader spot checks:
  - NVDA (Windows) and VoiceOver (macOS/iOS when available)
- Motion and zoom:
  - `prefers-reduced-motion` enabled
  - browser zoom at 200%

## Ownership and SLA
- Label: `a11y-portal`
- Default owner: portal frontend maintainer on-call
- SLA:
  - Critical: triage in 1 business day
  - Major: triage in 3 business days
  - Minor: triage in 5 business days

## Release Notes Requirement
Every release note should include:
- Accessibility fixes shipped
- Known accessibility gaps
- Owner and target date for unresolved critical/major items
