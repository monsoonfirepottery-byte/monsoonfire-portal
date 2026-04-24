# Website Playwright Smoke Runbook

## Purpose
Provide a fast browser-level smoke check for the marketing site that validates:
- first-view rendering across key pages
- mobile navigation presence
- support topic-filter interaction
- contact intake validation behavior

Outputs screenshots under `output/playwright/` for debugging and release evidence.
Also writes `smoke-summary.json` with per-check status and failure detail (if any).

## Native-browser shadow lane
- `npm run website:smoke:native-browser:shadow` prepares the advisory Codex-native shadow artifacts under `output/native-browser/website/prod`.
- `npm run website:smoke:native-browser:shadow:execute` runs the bounded `codex exec` wrapper and records structured evidence when native browser/computer-use is available.
- This lane is non-gating and advisory-only today.
- Playwright remains the authoritative website smoke gate for CI, release signoff, and production monitoring until native browser/computer-use is actually exposed in this execution path.

## Local usage
1. Install root dependencies:
```bash
npm ci
```
2. Install Chromium for Playwright:
```bash
npm run website:smoke:playwright:install
```
3. Run local smoke (serves `website/` automatically):
```bash
npm run website:smoke:playwright
```
Notes:
- Local mode auto-selects an available port (tries `4173`, `4174`, `4175`, `4183`) to avoid collisions.

## Production usage
Run against live site and save artifacts to `output/playwright/prod`:
```bash
npm run website:smoke:playwright:prod
```

Note:
- This command is intentionally strict.
- If production has not yet been deployed with the latest website changes, it will fail and surface the exact missing selector/page.

Equivalent custom target:
```bash
node ./scripts/website-playwright-smoke.mjs --base-url https://example.com --output-dir output/playwright/custom
```

## CI integration
Defined in `.github/workflows/ci-smoke.yml`:
- installs root deps
- installs Playwright Chromium
- runs `npm run website:smoke:playwright`
- uploads `output/playwright` as artifact (`website-playwright-smoke`)

Production monitor workflow:
- `.github/workflows/website-prod-smoke.yml`
- triggers:
  - manual (`workflow_dispatch`)
  - weekly schedule (Tuesdays 17:00 UTC)
- default URL:
  - `https://monsoonfire.com`
- uploads:
  - `website-playwright-prod-smoke` artifact (`output/playwright/prod-ci`)

## Failure triage
- `Missing mobile menu toggle`: verify header/menu toggle exists and is visible at 390x844.
- `Support payments topic filter did not become active`: check support topic buttons (`data-topic="payments"` or legacy `data-topic="pricing"`) and filter JS state.
- `Contact form validation error did not render`: check required fields and `[data-contact-error]` visibility logic.
- Browser missing: rerun `npm run website:smoke:playwright:install`.

## Current coverage pages
- `/`
- `/services/`
- `/kiln-firing/`
- `/memberships/`
- `/contact/`
- `/support/`
