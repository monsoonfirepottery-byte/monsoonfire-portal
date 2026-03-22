# Portal Automation Matrix

Purpose: define the active automation guardrails for portal functionality, UX consistency, and deploy confidence.

## Active automations

1. PR functional authz gate (`.github/workflows/portal-pr-functional-gate.yml`)
- Emulator-backed deterministic rules suites for:
  - My Pieces
  - Notifications mark-read
  - Direct messages
  - Ware check-ins
- Includes Firestore index contract guard check.
- Includes `continueJourney` endpoint runtime checks (success + input/authz/ownership denial cases) via `functions/lib/continueJourneyEndpoint.test.js`.

2. Daily authenticated production canary (`.github/workflows/portal-daily-authenticated-canary.yml`)
- Bootstraps auth from the shared agent refresh-token bundle by default.
- Verifies:
  - Navigation dock controls switch cleanly across `left`, `top`, `right`, and `bottom` positions with screenshot evidence.
  - Top/bottom dock flyout menus open and remain clickable.
  - Legacy `/requests` deep links (path + hash) redirect to supported destinations with migration guidance (`Support`, `Lending Library`, `Workshops`).
  - Dashboard -> My Pieces piece click-through
  - My Pieces loads without permission errors
  - Notifications mark-read feedback
  - Workshops page includes seeded QA workshop fixture content
  - Messages load without index/precondition failures
  - Ware Check-in loads without check-in/index failures
  - Ware Check-in optional sections stay collapsed by default and preserve values after expand/collapse (`canary-06b-ware-checkin-optional-sections.png`).
- Includes tri-theme contrast sweep by default (`portal`, `memoria`, `mono`).
- Includes staff-routing hardening checks that require dedicated workspace routes to remain durable:
  - `/staff/cockpit`
  - `/staff/workshops`
  - `/staff/system`
  - Unknown `/staff/*` paths recover to `/staff`.
- Runs every 30 minutes and escalates after 2 consecutive failures via rolling issue automation.

3. Firestore index contract guard (`.github/workflows/firestore-index-contract-guard.yml`)
- Checks required composite indexes in `firestore.indexes.json`.
- Opens/updates rolling GitHub issue when drift is detected.

4. Theme contrast regression (`.github/workflows/portal-theme-contrast-regression.yml`)
- Theme-only authenticated sweep across non-staff pages.
- Enforces minimum text/background contrast threshold.

5. Post-deploy promotion gate (`.github/workflows/portal-post-deploy-promotion-gate.yml`)
- Runs after successful `Deploy to Firebase Hosting on merge` (or manual dispatch).
- Requires pass on:
  - authenticated canary
  - virtual staff backend regression
  - index contract guard
- Authenticated canary in promotion mode now executes a runtime continue-journey linkage assertion:
  - trigger `Send to next firing` from My Pieces fixture row
  - verify new batch lineage (`journeyParentBatchId`, `journeyRootBatchId`) and draft/open state via Firestore reads
  - verify `CONTINUE_JOURNEY` timeline linkage to source batch
  - enforce cleanup status `clean` (promotion gate fails if journey cleanup is `partial`, `not_run`, or missing)
- Firestore index deploy permission-denied (`403`) outcomes are downgraded to warnings in workflow mode so IAM drift does not mask user-facing deploy health.
- Any other failing gate condition still blocks promotion confidence.

6. Fixture steward (`.github/workflows/portal-fixture-steward.yml`)
- Seeds daily QA fixtures:
  - piece + batch
  - studio update announcement
  - published workshop/event fixture
  - direct message thread/message
  - notification target (admin token when available)
- Validates fixture existence and cleans stale fixtures by TTL.

7. Branch divergence guard (`.github/workflows/branch-divergence-guard.yml`)
- Monitors `main` and `codex/*` for non-fast-forward rewrites.
- Opens/updates alert issue when force-push/divergence is detected.

8. Credential health guard (`.github/workflows/portal-credential-health.yml`)
- Validates required deploy/auth secrets are present.
- Probes staff token minting (refresh-token preferred), optional password fallback sign-in, agent refresh-token exchange, and Firestore Rules API token health.
- Posts rolling status comments for early incident visibility.

9. Rules + index drift blocker (`.github/workflows/rules-index-drift-blocker.yml`)
- Blocks PRs when cloud Firestore rules release mapping drifts.
- Blocks PRs when required Firestore composite indexes are missing.

10. Portal automation health dashboard (`.github/workflows/portal-automation-health-daily.yml`)
- Aggregates latest 24-48h workflow evidence across canary/index/promotion/smoke/PR-functional/load/coldstart loops.
- Publishes daily JSON + markdown health artifacts.
- Emits threshold tuning recommendations and opens/updates repeated-signature issues.

11. Portal automation weekly digest (`.github/workflows/portal-automation-weekly-digest.yml`)
- Computes trend deltas from daily dashboard artifacts.
- Tracks pass-rate movement, top flaky signatures, and new remediation candidates.
- Posts rolling weekly digest updates for planning and prioritization.

12. Community layout canary (`.github/workflows/portal-community-layout-canary.yml`)
- Authenticated Community-page regression check for right-rail stability.
- Bootstraps browser auth from refresh-token credentials by default; raw password is fallback-only.
- Verifies sidebar width does not drift after async report refresh.
- Fails on detectable chiplet/report/video overflow and uploads screenshot/report artifacts.
- Used as the required verification gate for Community content rotations.

13. Portal load test lane (`.github/workflows/portal-load-test.yml`)
- Exercises public Cloud Functions endpoint throughput under quick/default/deep profiles.
- Supports an additional `soak` profile for sustained-load endurance checks.
- Enforces scenario thresholds for p95 latency, expected-status rate, network/server error rates, and rate-limit behavior.
- Runs daily and on manual dispatch with override inputs for profile, endpoint path, and strict mode.

14. Functions coldstart regression lane (`.github/workflows/functions-coldstart-regression.yml`)
- Measures cold import time across key backend modules plus composite `index + apiV1`.
- Enforces default and per-target p95 budgets in strict mode.
- Runs daily and on manual dispatch with override inputs for runs, global budget, and per-target budget map.

15. Reservations journey click-efficiency guard (`web/scripts/check-reservations-journey-playwright.mjs`)
- Validates pickup-delivery guardrail messaging in Ware Check-in.
- Captures click count for the goal path (sign in -> Ware Check-in -> pickup toggle -> submit).
- Writes machine-readable metrics (`tmp/reservations-journey-metrics.json`) so we can track interaction friction over time.

16. Industry events reliability checks (`npm run events:industry:check`)
- Validates industry-events contracts/helpers and EventsView integration tests.
- Runs connector ingest dry-run with deterministic dedupe + failure artifact.
- Runs freshness audit artifact generation.
- Runs canary checks for non-empty feed, filter behavior, link validity, and stale-event suppression.

## Friction tuning log (2026-03-02)

- Reservations Step 4 policy helper now needs centered presentation to keep scanability high.
- Reservations Step 5 had low-signal clutter (`Most people start here`, space gauge copy, duplicate estimate language) that reduced trust.
- Reservations Step 6 add-on framing needed clearer fairness language for priority queue (line-cut penalty tradeoff).
- Priority queue now requires community shelf fill-in consent by policy to rebalance queue fairness.
- Community shelf now enforces a tiny-load cap (under one half shelf per check-in) to prevent free-firing misuse.
- Staff glaze-prep language was confusing; refocused on concrete “staff follows your glaze/wax directions” intent and per-half-shelf pricing.
- Need-by deadline behavior now follows urgency-aware prompts (2-week suggest, 1-week preselect with opt-out).
- Keep running click-efficiency metrics and fold recurring friction signatures into weekly automation digest / self-improvement loops.
- Staff console routing now uses only canonical deep link `/staff/cockpit` for cockpit launch; legacy `/cockpit` alias handling was removed to avoid ambiguous route state and preserve deterministic staff-workspace state.
- Staff console path canonicalization now retains `/staff` as the durable full console path; focused workspaces still own `/staff/cockpit`, `/staff/workshops`, and `/staff/system`, and unknown `/staff/*` paths fall back to `/staff` for lower-friction recovery.
- Staff workspace transitions from the active staff page now prefer in-app canonical staff-route updates (history push/replace) rather than full reloads, reducing low-value route-friction when moving between dedicated workspaces.
- Cockpit-mode exit now also stays in-app (no `window.location.assign`) by using the same canonical staff workspace opener, reducing one extra reload cycle when staff operators return from `/staff/cockpit` to `/staff`.
- Unknown dedicated-cockpit deep links now normalize to the nearest supported cockpit segment (for example `/staff/cockpit/does-not-exist` -> `/staff/cockpit`) so stale links can’t strand operators in unsupported URLs.
- Hash deep-link fallbacks now preserve dedicated workspace intent when the path is the staff root (for example `/staff#/staff/workshops`) while still preserving route determinism for explicit non-root staff paths.
- Staff workspace request resolution now uses one shared helper for path+hash intent (`resolveStaffWorkspaceRequestedPath`) so URL normalization and deterministic canonicalization are centralized, reducing duplicate branching and recovery ambiguity.
- Staff path variants now also normalize common shorthand/copy/paste forms (`/staff/workshop`, `/staff/ops`, `/staff/cockpit/ops`) to focused operations workspace targets so operators don’t hit a fallback mode from quick links.
- `/staff#/staff/...` links now normalize to deterministic dedicated workspace URLs (for example `/staff/workshops`) so staff links are copy/paste-safe and avoid legacy hash-route ambiguity.
- Staff-path canonicalization and canary checks now strip hash fragments as well as query strings before slash normalization so noisy links like `/staff/workshops#utm=ci` stay deterministic.
- Staff path canonicalization now also tolerates legacy hash-bang route prefixes (`/#!/...`, `#!/...`) so staff deep links resolve to deterministic workspace mode without extra navigation friction.
- Staff path normalization now also accepts protocol-less staff links that include host ports (for example `portal.monsoonfire.com:5173/staff/system`, `localhost:5173/staff/cockpit`) so local/dev copy-paste URLs land in a canonical staff workspace.
- Staff-console workspace navigation now normalizes redundant slashes and trailing separators before path checks, which prevents ambiguous route state from `/staff/.../` style links and keeps dedicated-workspace handoff deterministic.
- Staff canonicalization and canary checks now also cover noisy path variants (`/staff/.../`, mixed-case legacy forms, and `/#/staff/...`) so operational routing remains deterministic before dedicated workspace rendering.
- Staff path handling now tolerates absolute URLs in staff route payloads (for example `https://portal.monsoonfire.com/staff/workshops` and `.../#/staff/system`) so helper callers and automation logs can pass URL-like inputs without bypassing routing hardening.
- Staff workspace open normalization also resolves staff fragments on absolute URLs where the main path is non-staff (for example `https://portal.monsoonfire.com/dashboard#/staff/workshops`) so full copied URLs continue to land in the intended dedicated workspace.
- Staff absolute URLs now also preserve staff-only hash intents when the base path is already `/staff` (for example `https://portal.monsoonfire.com/staff#/system`) so deep links from old/legacy formats no longer collapse to the console root.
- Staff path normalization now preserves staff hash intent even when staff query parameters precede the hash (for example `/staff?from=legacy#finance`) so query-only copy/paste variants resolve to the intended dedicated workspace tab.
- App-level staff route sync now immediately canonicalizes requested staff paths on hash/popstate updates (including already-open staff sessions), so hash-only deep links like `/dashboard#/staff/system` no longer linger in non-canonical form.
- Split pathname/hash routing now also preserves bare staff-root hash intents in app-launch flow (for example browser path `/staff` with `window.location.hash = "#finance"`) so runtime workspace handoff stays on dedicated cockpit paths.
- Staff path canonicalization now also handles encoded hash markers in staff deep links (for example `/%23/staff/cockpit`), preserving deterministic workspace resolution from link-safe variants.
- Staff canonicalization also now handles fully URL-encoded absolute staff links (for example `https%3A%2F%2Fportal.monsoonfire.com%2Fstaff%2Fsystem`) so encoded transport channels do not reintroduce workspace-friction ambiguity.
- Staff canonicalization also handles protocol-relative URLs (for example `//portal.monsoonfire.com/staff/cockpit`) so link variants shared across environments continue resolving deterministically.
- Legacy hash variants are also normalized when the hash marker omits a leading slash (for example `#staff/workshops`), so staff deep links remain deterministic even with mixed copy/paste formats.
- Staff workspace open action now hardens empty or whitespace-only targets by defaulting to `/staff` so low-value "click/no-op" outcomes are avoided.
- Staff path handling now also accepts protocol-less staff links such as `portal.monsoonfire.com/staff/cockpit` by treating them as staff URLs before canonicalization, reducing copy/paste friction from shared links that omit a scheme.
- Staff workspace navigation now clears stale hash fragments when opening a canonical staff target, so links like `/staff#system` or `/staff/cockpit#finance` no longer carry outdated hash state into the destination workspace.
- Staff path normalization now also accepts Windows-style backslash fragments (for example `\staff\system` and `portal.monsoonfire.com\staff\cockpit\finance`) so clipboard copies from mixed environments stay deterministic.
- `/staff/cockpit#finance` style hash links now preserve the cockpit tab intent as a dedicated path (`/staff/cockpit/finance`) instead of collapsing to `/staff/cockpit` root.
- Staff path matching is now resilient to punctuation-wrapped/trimmed copy-paste links (for example `/staff/workshops)`, `"https://portal.monsoonfire.com/staff/system,"`, `(https://portal.monsoonfire.com/staff/cockpit/finance,)`) so accidental trailing punctuation does not strand operators on fallback routes.

- Staff canonicalization now also decodes percent-encoded separators and removes `.` / `..` path fragments (for example `/staff%2fcockpit`, `/staff/%2e%2e/system`) so noisy encoded deep links route deterministically before workspace mode selection.

- Staff console navigation now preserves cockpit/workshop/system module path segments on path recovery (for example `/staff#/staff/cockpit/commerce`) instead of collapsing to the workspace root, preventing low-value friction for direct deep links into dedicated staff modules.
- App-level route synchronization now reacts to `hashchange` events, so staff hash-only deep links can re-resolve workspace mode/path without requiring a reload.

## Local commands

```bash
npm run portal:pr:functional:gate
npm run portal:canary:auth
npm run portal:canary:community-layout
npm run portal:canary:escalate
npm run portal:theme:contrast
npm run portal:load:test:quick
npm run portal:load:test
npm run portal:load:test:deep
npm run portal:load:test:soak
npm run functions:profile:coldstart:strict
npm run qa:preflight:performance
npm run portal:index:guard
npm run rules:index:drift:blocker
npm run deploy:preflight
npm run deploy:evidence:pack
npm run branch:divergence:guard
npm run secrets:health:check
npm run portal:fixture:steward
npm run portal:promotion:gate
npm run portal:automation:dashboard
npm run portal:automation:issues
npm run portal:automation:issues:apply
npm run portal:automation:weekly-digest
npm run portal:automation:weekly-digest:apply
npm --prefix web run check:reservations-journey-playwright
npm run events:industry:check
npm run events:industry:import
npm run events:industry:freshness:audit
npm run events:industry:canary
```

`portal:canary:auth` and `portal:theme:contrast` now prefer refresh-token credentials from:
- `PORTAL_AGENT_STAFF_CREDENTIALS_JSON` (expects `email` + `uid` + `refreshToken`)
- `PORTAL_AGENT_STAFF_CREDENTIALS` (or default `~/secrets/portal/portal-agent-staff.json`)
- `PORTAL_STAFF_EMAIL` + `PORTAL_STAFF_PASSWORD` remain optional for explicit `--auth-mode password-ui` diagnostics

## Local secrets directory (gitignored)

For local execution, keep the canonical shared cache under `~/secrets/portal/` and mirror into repo-local `secrets/portal/` only when a worktree needs local copies:

- `~/secrets/portal/portal-agent-staff.json`
- `~/secrets/portal/portal-automation.env`
- `secrets/portal/firebase-service-account-monsoonfire-portal-github-action.json`

Refresh with:

- `npm run secrets:portal:sync`
- `npm run secrets:sync:runtime`

The `portal-automation.env` file should define at least:

- `PORTAL_AGENT_STAFF_CREDENTIALS`
- `PORTAL_STAFF_EMAIL`
- `FIREBASE_RULES_API_TOKEN` (supports OAuth access token or Firebase CLI refresh token format `1//...`)
- `PORTAL_FIREBASE_API_KEY`
- `FIREBASE_WEB_API_KEY` (local compatibility mirror; keep equal to `PORTAL_FIREBASE_API_KEY`)

Recommended for full promotion/deploy coverage:

- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` or `GOOGLE_APPLICATION_CREDENTIALS` (index deploy auth for promotion gate)
- `WEBSITE_DEPLOY_KEY` (Namecheap deploy SSH key path; usually `~/.ssh/namecheap-portal`)
- `PORTAL_CANARY_ADMIN_TOKEN` (preferred) or `PORTAL_ADMIN_TOKEN` so journey cleanup can always use lifecycle close path (`pickedUpAndClose`) during promotion canary runs
- `PORTAL_STAFF_PASSWORD` only when you want the explicit password-ui fallback

Local baseline note:
- As of March 1, 2026, `secrets/portal/portal-automation.env` includes populated `PORTAL_FIREBASE_API_KEY` and `FIREBASE_WEB_API_KEY` entries for promotion-gate and script compatibility.
- `FIREBASE_RULES_API_TOKEN` is expected to use the Firebase CLI refresh token (`1//...`) in local setups so rules checks can mint fresh access tokens on each run.
- The rotated GitHub Actions service-account JSON is stored at `secrets/portal/firebase-service-account-monsoonfire-portal-github-action.json` and referenced via `GOOGLE_APPLICATION_CREDENTIALS` in `portal-automation.env`.
- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` remains optional locally when `GOOGLE_APPLICATION_CREDENTIALS` is set.

Moving-forward rule:

- Any new local secret used by portal automations must be added to `secrets/portal/portal-automation.env` (or a referenced file under `secrets/portal/`).
- Docs should record secret locations and variable names only; never paste raw secret values.
- If a script introduces a new required secret, update this runbook in the same PR/commit.

Load into your shell before running automation commands:

```bash
set -a
source ~/secrets/portal/portal-automation.env
set +a
```

Performance preflight summary artifact:
- `output/qa/performance-preflight.json`

Reference provenance:

- staff credential bootstrap/run metadata: `docs/DRILL_EXECUTION_LOG.md`
- staff claim setup contract: `docs/STAFF_CLAIMS_SETUP.md`
- local rules-token source: `~/.config/configstore/firebase-tools.json` (`tokens.refresh_token`)

## Required secrets (CI)

- `PORTAL_AGENT_STAFF_CREDENTIALS_JSON` (required for backend regression, credential health, and authenticated canary bootstrap; must include `email`, `uid`, and `refreshToken`)
- `PORTAL_STAFF_EMAIL` (kept for operator clarity and optional fallback flows)
- `FIREBASE_RULES_API_TOKEN`
- `PORTAL_FIREBASE_API_KEY` (required for token-exchange probes and fixture stewardship; keep in sync with `FIREBASE_WEB_API_KEY`)
- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` (recommended for notification fixture seeding)
- `PORTAL_CANARY_ADMIN_TOKEN` (preferred) or `PORTAL_ADMIN_TOKEN` (optional but recommended for deterministic promotion-gate journey cleanup)

## Secret rotation policy (ops)

Owner:
- Primary: portal operator (Micah/Wuff)
- Backup: designated release duty engineer

Scope:
- `PORTAL_CANARY_ADMIN_TOKEN`
- `PORTAL_ADMIN_TOKEN`
- `PORTAL_STAFF_EMAIL`
- `PORTAL_AGENT_STAFF_CREDENTIALS_JSON`
- `PORTAL_STAFF_PASSWORD` (optional fallback only)

Rotation cadence:
- `PORTAL_CANARY_ADMIN_TOKEN`: every 30 days
- `PORTAL_ADMIN_TOKEN`: every 30 days (match canary token unless split is required)
- Staff credentials (`PORTAL_STAFF_EMAIL`, `PORTAL_AGENT_STAFF_CREDENTIALS_JSON`, optional `PORTAL_STAFF_PASSWORD`): every 60 days
- Immediate rotation on leak suspicion, offboarding, or auth anomalies

Rotation procedure:
1. Generate new token/credentials.
2. Update GitHub Actions secrets first.
3. Update the dedicated 1Password vault, run `npm run secrets:portal:sync`, then mirror into any active worktree with `npm run secrets:sync:runtime`.
4. Run `Portal Credential Health` and `Portal Post-Deploy Promotion Gate`.
5. Confirm both workflows are green before closing the rotation task.

Evidence:
- Record rotation date, owner, and workflow run URLs in release notes or ops log.
- Never store raw secret values in repo files, issues, or chat transcripts.

## Related runbook

- `docs/runbooks/PORTAL_AUTOMATION_SELF_IMPROVEMENT_LOOPS.md`
- `docs/runbooks/PORTAL_QA_LOOP_NON_STAFF.md`
- `docs/runbooks/PORTAL_PERFORMANCE_QA_LANES.md`
- `docs/runbooks/COMMUNITY_CONTENT_ROTATION_RUNBOOK.md`
- `docs/runbooks/LOCAL_SECRETS_LAYOUT.md`
