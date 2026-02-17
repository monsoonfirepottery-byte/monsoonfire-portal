# Website Accessibility Regression Guardrails

## Automated Checks
- Lighthouse runs on PRs and pushes to `main` via `.github/workflows/lighthouse.yml`.
- Website-specific Lighthouse config:
  - `website/lighthouserc.json`
- Playwright website smoke runs in `.github/workflows/ci-smoke.yml`:
  - command: `npm run website:smoke:playwright`
  - artifact: `website-playwright-smoke` (screenshots + interaction evidence)
- Production smoke monitor runs in `.github/workflows/website-prod-smoke.yml`:
  - command: `node ./scripts/website-playwright-smoke.mjs --base-url https://monsoonfire.com --output-dir output/playwright/prod-ci`
  - artifact: `website-playwright-prod-smoke`
- Runbook:
  - `docs/runbooks/WEBSITE_PLAYWRIGHT_SMOKE.md`
- Must-pass pages:
  - `/`
  - `/memberships/`
  - `/kiln-firing/`
  - `/studio-access/`
  - `/support/`
- Assertion thresholds:
  - Accessibility: `>= 0.90` (error)
  - Best Practices: `>= 0.85` (warn)

## Manual Cadence
- Monthly:
  - keyboard-only pass
  - screen reader smoke checks (VoiceOver + NVDA spot checks)
  - caption/transcript checks for media content
- Quarterly:
  - deep-dive accessibility audit and remediation plan

## Severity Model
- Critical:
  - blocks navigation, form completion, or core information access for assistive users.
  - release-blocking.
- Major:
  - significant friction for assistive tech users on primary paths.
  - target fix in next release window.
- Minor:
  - non-blocking issues with reasonable workarounds.
  - scheduled in normal backlog.

## Ownership and SLA
- Label: `a11y-website`
- Owner: website maintainers
- SLA:
  - Critical triage: 1 business day
  - Major triage: 3 business days
  - Minor triage: 5 business days

## Release Notes Changelog Requirement
Each website release note should include:
- accessibility improvements shipped
- known open accessibility gaps
- owner + target date for unresolved critical/major items
