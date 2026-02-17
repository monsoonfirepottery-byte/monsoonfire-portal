# P2 — Website Production Smoke Parity Deploy

Status: Completed
Priority: P2
Severity: Sev2
Component: website
Impact: high
Tags: website, deploy, smoke, production

## Problem statement
Production smoke checks now run against `https://monsoonfire.com`, but live pages are currently behind local changes. The strict prod smoke fails at `/contact/` because `form[data-contact-intake]` is not present in production.

## Proposed solution
- Deploy the completed website updates to production.
- Re-run strict production smoke until all required selectors/interactions pass.
- Attach artifact evidence from the production smoke workflow.

## Acceptance criteria
- `node ./scripts/website-playwright-smoke.mjs --base-url https://monsoonfire.com --output-dir output/playwright/prod-ci` passes.
- `output/playwright/prod-ci/smoke-summary.json` shows `"status": "passed"`.
- Desktop/mobile screenshots exist for all covered routes.

## Manual test checklist
1. Run `npm run website:smoke:playwright:prod`.
2. Confirm contact page includes intake form and validation behavior.
3. Confirm support page topic filter interaction passes.
4. Confirm artifact bundle includes screenshots and summary JSON.

## Dependencies
- `tickets/P2-website-contact-page-conversion-intake.md`
- `tickets/P3-website-support-faq-progressive-disclosure.md`

## Notes
- Production monitor workflow: `.github/workflows/website-prod-smoke.yml`

## Completion notes (2026-02-17)
- Deployed latest website payload to production host via `website/deploy.ps1`.
- Fixed deploy script interpolation bug for remote SCP target (`${Server}:$RemotePath`).
- Promoted uploaded `public_html/ncsitebuilder` payload into live `public_html` after upload.
- Verified strict production smoke now passes:
  - `node ./scripts/website-playwright-smoke.mjs --base-url https://monsoonfire.com --output-dir output/playwright/prod-post-deploy`
  - `output/playwright/prod-post-deploy/smoke-summary.json` => `"status": "passed"`
