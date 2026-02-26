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
  - Dashboard -> My Pieces piece click-through
  - My Pieces loads without permission errors
  - Notifications mark-read feedback
  - Messages load without index/precondition failures
  - Ware Check-in loads without check-in/index failures
- Includes dual-theme contrast sweep by default.

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
- Failing gate blocks promotion confidence.

6. Fixture steward (`.github/workflows/portal-fixture-steward.yml`)
- Seeds daily QA fixtures:
  - piece + batch
  - studio update announcement
  - direct message thread/message
  - notification target (admin token when available)
- Validates fixture existence and cleans stale fixtures by TTL.

## Local commands

```bash
npm run portal:pr:functional:gate
npm run portal:canary:auth
npm run portal:theme:contrast
npm run portal:index:guard
npm run portal:fixture:steward
npm run portal:promotion:gate
```

## Required secrets (CI)

- `PORTAL_STAFF_EMAIL`
- `PORTAL_STAFF_PASSWORD`
- `PORTAL_AGENT_STAFF_CREDENTIALS_JSON`
- `FIREBASE_RULES_API_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT_MONSOONFIRE_PORTAL` (recommended for notification fixture seeding)
