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

## 2026-02-21 follow-up stabilization pass (fix-ensureUserDoc-seed-staff-20260221)
- Initialized clean worktree branch from verify-emulators-telemetry-uxcaps-20260221.

### Java + emulator unblock and evidence rerun
- `java` missing in shell; installed portable Temurin runtimes under `~/.local/`:
  - `~/.local/jre17-portable` (for compatibility tests)
  - `~/.local/jre21-portable` (required by current firebase-tools)
- Emulator startup command used for this pass:
  - `JAVA_HOME=/home/wuff/.local/jre21-portable PATH=/home/wuff/.local/jre21-portable/bin:$PATH firebase emulators:start --config firebase.emulators.local.json --project monsoonfire-portal --only auth,firestore,functions > artifacts/telemetry/ensureUserDoc-errors.log 2>&1`
- Active emulator ports:
  - Auth `127.0.0.1:9099`
  - Firestore `127.0.0.1:8085`
  - Functions `127.0.0.1:5001`
  - UI `http://127.0.0.1:4000`
- Seeded deterministic data:
  - `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 GCLOUD_PROJECT=monsoonfire-portal npm run seed:emulators`
- Captured telemetry evidence:
  - `TELEMETRY_OUT_DIR=artifacts/telemetry/after-seed node scripts/capture-telemetry-evidence.mjs`
  - Output bundle: `artifacts/telemetry/after-seed/`

### ensureUserDoc error diagnosis and fix
- Root cause found in prior implementation path:
  - Firestore transaction mixed reads after writes in same transaction flow, which can trigger repeated transaction failures/log spam under emulator traffic.
- Fix implemented:
  - Replaced with idempotent get-then-create flow (no read-after-write transaction pattern).
  - Added explicit `OPTIONS` handling, strict `POST` behavior, and structured JSON error responses.
  - Added field sanitization to avoid writing `undefined`.
  - Client bootstrap throttles retries so failures remain non-blocking and non-spammy.
- Verification evidence:
  - `artifacts/telemetry/ensureUserDoc-errors.log` includes successful completions:
    - `ensureUserDoc complete`
    - `emulatorGrantStaffRole complete`
  - No repeating error stack traces for `ensureUserDoc` in this rerun.

### Captured telemetry summary (after seed)
- Startup (A): reads=2, writes=0
- Messages open (B): reads=3, writes=0
- Thread open (C): reads=3, writes=0
- My Pieces initial/load-more (E/F): reads rose under seeded pagination flow (see evidence file)
- Glaze Board idle (G): listener events observed with capped listeners
- Staff before/after load (H/I): captured in evidence screenshots and markdown

## 2026-02-21 final stabilization pass (fix-node-engine-and-capture-20260221)
- Created branch: `fix-node-engine-and-capture-20260221`.
- Standardized Node target for emulator/dev consistency:
  - Added repo `.nvmrc` with `22`.
  - Added root `package.json` engines: `"node": "22"` to match `functions/package.json`.
  - nvm usage:
    - `nvm install 22`
    - `nvm use 22`
- Optional Java helper added:
  - `source ./scripts/use-java.sh`
  - Sets `JAVA_HOME=~/.local/jre21-portable` and prepends `PATH`.
- Improved deterministic telemetry capture for seeded messages flow:
  - Added stable message test IDs in `MessagesView.tsx`:
    - `messages-thread-list`
    - `thread-item-<threadId>`
    - `messages-message-list`
    - `messages-load-older`
  - Updated `scripts/capture-telemetry-evidence.mjs` to:
    - target seeded thread ID (`seed-thread-client-staff` by default)
    - assert initial message bubbles >= 50
    - click `Load older messages (next 50)` via test ID
    - assert message bubbles increase to at least 100
- New capture output path:
  - `artifacts/telemetry/after-seed-2/`
- End-to-end rerun under Node 22 + Java 21 portable runtimes:
  - Emulators started with `PATH=/home/wuff/.local/node22-portable/bin:/home/wuff/.local/jre21-portable/bin:$PATH`
  - Functions emulator log confirms: `Using node@22 from host.`
- Fixed Firestore rules regression blocking direct message list query in emulator:
  - `firestore.rules` direct message read/update participant checks now use `request.auth.uid in resource.data.participantUids`.
- Telemetry capture rerun succeeded with deterministic seeded thread and Load Older proof:
  - `artifacts/telemetry/after-seed-2/03-thread-open.png` (initial 50 bubbles)
  - `artifacts/telemetry/after-seed-2/04-load-older-1.png` (after click: 100 bubbles)
  - `artifacts/telemetry/after-seed-2/telemetry-results.md`
- Validation checks (Node 22 path):
  - `npm --prefix functions run build` ✅
  - `npm --prefix functions run lint` ✅
  - `npm --prefix web run build` ✅
  - `npm --prefix web run lint` ✅

## 2026-02-21 security/regression hardening pass (harden-rules-tests-devscripts-20260221)
- Added Firestore Security Rules unit tests for direct messages:
  - `scripts/rules/directMessages.rules.test.mjs`
  - Covers participant/staff/anonymous ALLOW+Deny behavior for thread docs, message docs, thread query filtering, and constrained updates.
- Added root scripts:
  - `test:rules` runs rules tests via Firestore emulator using `firebase emulators:exec`.
  - `verify:local` runs rules tests + functions/web build+lint.
- Updated web dev ergonomics:
  - `web` `dev` now runs Vite only.
  - `web` `test:watch` runs Vitest watcher explicitly.
  - `web` `test` now runs Vitest in run mode.
- Added staff-aware direct message rule checks while preserving field-level write constraints.
- Local verification run:
  - `npm run verify:local` ✅
  - Rules tests: 14/14 passing (`scripts/rules/directMessages.rules.test.mjs`).

## 2026-02-21 telemetry artifact hygiene pass (hygiene-telemetry-artifacts-20260221)
- Implemented Option A telemetry git policy:
  - track only `artifacts/telemetry/latest-telemetry-results.md` and `.json`
  - ignore/untrack screenshots, logs, and timestamped capture folders.
- Promoted stable latest snapshot from `artifacts/telemetry/after-seed-2/`.
- Updated `.gitignore` and `COST_NOTES.md` with regeneration + promotion workflow.
- Fresh checkout: run `npm run verify:bootstrap`
