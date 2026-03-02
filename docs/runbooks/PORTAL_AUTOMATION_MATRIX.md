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

2. Daily authenticated production canary (`.github/workflows/portal-daily-authenticated-canary.yml`)
- Signs in using staff credentials.
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
- Probes staff sign-in, agent refresh-token exchange, and Firestore Rules API token health.
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
```

`portal:canary:auth` and `portal:theme:contrast` auto-resolve staff credentials from:
- `PORTAL_STAFF_EMAIL` + `PORTAL_STAFF_PASSWORD`
- `PORTAL_AGENT_STAFF_CREDENTIALS_JSON` (expects `email` + `password`)
- `PORTAL_AGENT_STAFF_CREDENTIALS` (or default `secrets/portal/portal-agent-staff.json`)

## Local secrets directory (gitignored)

For local execution, keep credentials in the repo-local `secrets/` bundle:

- `secrets/portal/portal-agent-staff.json`
- `secrets/portal/portal-automation.env`
- `secrets/portal/firebase-service-account-monsoonfire-portal-github-action.json`

The `portal-automation.env` file should define at least:

- `PORTAL_AGENT_STAFF_CREDENTIALS`
- `PORTAL_STAFF_EMAIL`
- `PORTAL_STAFF_PASSWORD`
- `FIREBASE_RULES_API_TOKEN` (supports OAuth access token or Firebase CLI refresh token format `1//...`)
- `PORTAL_FIREBASE_API_KEY`
- `FIREBASE_WEB_API_KEY` (local compatibility mirror; keep equal to `PORTAL_FIREBASE_API_KEY`)

Recommended for full promotion/deploy coverage:

- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` or `GOOGLE_APPLICATION_CREDENTIALS` (index deploy auth for promotion gate)
- `WEBSITE_DEPLOY_KEY` (Namecheap deploy SSH key path; usually `~/.ssh/namecheap-portal`)

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
source /home/wuff/monsoonfire-portal/secrets/portal/portal-automation.env
set +a
```

Performance preflight summary artifact:
- `output/qa/performance-preflight.json`

Reference provenance:

- staff credential bootstrap/run metadata: `docs/DRILL_EXECUTION_LOG.md`
- staff claim setup contract: `docs/STAFF_CLAIMS_SETUP.md`
- local rules-token source: `~/.config/configstore/firebase-tools.json` (`tokens.refresh_token`)

## Required secrets (CI)

- `PORTAL_AGENT_STAFF_CREDENTIALS_JSON` (required for backend regression and credential health probes; can also satisfy canary auth when it includes `email` + `password`)
- `PORTAL_STAFF_EMAIL` + `PORTAL_STAFF_PASSWORD` (canary fallback when JSON payload does not include email/password fields)
- `FIREBASE_RULES_API_TOKEN`
- `PORTAL_FIREBASE_API_KEY` (required for token-exchange probes and fixture stewardship; keep in sync with `FIREBASE_WEB_API_KEY`)
- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` (recommended for notification fixture seeding)

## Related runbook

- `docs/runbooks/PORTAL_AUTOMATION_SELF_IMPROVEMENT_LOOPS.md`
- `docs/runbooks/PORTAL_QA_LOOP_NON_STAFF.md`
- `docs/runbooks/PORTAL_PERFORMANCE_QA_LANES.md`
- `docs/runbooks/COMMUNITY_CONTENT_ROTATION_RUNBOOK.md`
- `docs/runbooks/LOCAL_SECRETS_LAYOUT.md`
