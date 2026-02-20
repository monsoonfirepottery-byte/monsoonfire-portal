# WORKLOG

## Task
Full marketing-site UI/UX + accessibility pass for `monsoonfire.com` website (not portal), including light/dark theme toggle, accessibility toolbar, Playwright + axe tests, and isolated Namecheap preview deployment.

## Timeline
- 2026-02-20: Initialized branch and worklog.
- 2026-02-20: Audited live site and stack.
  - `curl -I https://monsoonfire.com` confirmed static LiteSpeed serving.
  - `curl -s https://monsoonfire.com/sitemap.xml` mapped major landing pages.
  - `ssh -i ~/.ssh/namecheap-portal -p 21098 monsggbd@66.29.137.142` verified docroot at `public_html/` and isolated preview path feasibility.
- 2026-02-20: Built preview deployment flow.
  - Added `scripts/deploy-namecheap-preview.mjs`.
  - First successful isolated deploy URL: `https://monsoonfire.com/__preview/ux-a11y-theme-toggle-20260220-initial/`.
  - Final review deploy URL: `https://monsoonfire.com/__preview/ux-a11y-theme-toggle-20260220-r1/`.
- 2026-02-20: Implemented UI/UX + accessibility pass in shared website assets.
  - Updated `website/ncsitebuilder/assets/css/styles.css` with:
    - portal-inspired dark theme tokens
    - high-contrast/text-size/focus/motion variants
    - toolbar/theming control styles
    - global focus-ring, header polish, and reduced-motion handling
  - Replaced `website/ncsitebuilder/assets/js/main.js` with:
    - persistent light/dark theme logic (`localStorage`, `prefers-color-scheme`)
    - keyboard-accessible accessibility toolbar and control persistence
    - semantic/landmark enhancements and skip-link consistency
    - preview-prefix awareness for isolated preview paths
- 2026-02-20: Added Playwright + axe test suite.
  - Added `website/playwright.config.mjs`.
  - Added `website/tests/marketing-site.spec.mjs`.
  - Added scripts in `package.json`: `test:e2e`, `test:e2e:headed`, `test:e2e:dev`, `website:deploy:preview`.
  - Installed dev deps: `@playwright/test`, `@axe-core/playwright`.
- 2026-02-20: Validation runs.
  - `npm run test:e2e` passed (18/18).
  - `BASE_URL='https://monsoonfire.com/__preview/ux-a11y-theme-toggle-20260220-r1/' npm run test:e2e:dev` passed (18/18).
  - Final preview redeployed after preview-rewrite hardening and revalidated at HTTP 200.
