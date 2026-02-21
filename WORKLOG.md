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
\n## 2026-02-21 verification pass
- Started branch: verify-emulators-telemetry-uxcaps-20260221
- Pre-existing dirty working tree detected; preserving unrelated changes and scoping edits to targeted files.
- Installed local Java runtimes in user space:
  - `~/.local/java/jdk-17.0.18+8-jre`
  - `~/.local/java/jdk-21.0.10+7-jre`
- Firebase emulator startup required Java 21 with current `firebase-tools`.
- Started emulators with local config override due occupied port 8080:
  - Auth: `127.0.0.1:9099`
  - Functions: `127.0.0.1:5001`
  - Firestore: `127.0.0.1:8085`
  - Emulator UI: `http://127.0.0.1:4000`
- Ran Vite against emulators:
  - `http://127.0.0.1:5173`
- Captured telemetry evidence:
  - `artifacts/telemetry/telemetry-results.json`
  - `artifacts/telemetry/telemetry-results.md`
  - `artifacts/telemetry/*.png`
- Added UX cap messaging in Messages, My Pieces, Glaze Board, and Staff.
- Added/normalized Firestore index definitions in `firestore.indexes.json`.
- Telemetry capture summary (latest run):
  - Startup (10s idle): reads=2, writes=0
  - Messages view open: reads=2, writes=0
  - Thread open: reads=3, writes=4
  - My Pieces initial: reads=3, writes=4
  - My Pieces load-more interaction: reads=3, writes=4
  - Glaze Board idle (10s): reads=3, writes=4, listener events=3
- Capture limitations:
  - Load-older messages button unavailable with current local dataset (<50 in thread).
  - Staff nav not visible under anonymous emulator auth; claim escalation via emulator API returned INSUFFICIENT_PERMISSION.
