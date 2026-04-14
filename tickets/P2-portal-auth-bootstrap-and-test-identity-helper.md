# P2 — Portal auth bootstrap and test identity helper

Status: Completed
Date: 2026-04-12
Priority: P2
Owner: Portal / QA
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-tool-surface-and-portal-operator-access.md

## Problem
Portal automation now prefers refresh-token credentials, but manual staff and admin reproductions still rely on hidden env knowledge and token hunting. This slows debugging and increases the risk of mixing production bearer auth with emulator-only admin-token flows.

## Tasks
1. Add a helper command that resolves the canonical portal staff credential bundle and mints or refreshes a usable staff auth context without printing raw secrets.
2. Print expiry, UID, email, and safe-to-copy header or env snippets for scripts and curl usage while redacting sensitive values.
3. Keep emulator-only `x-admin-token` guidance explicit and separate from production staff bearer flows.
4. Document the helper in the portal automation matrix and staff or auth runbooks.

## Acceptance Criteria
1. An operator can bootstrap a staff auth context from the standard `secrets/portal` credential bundle or `portal-automation.env` without manual Firebase console spelunking.
2. Output clearly separates production bearer auth from emulator-only admin-token usage.
3. Existing canary or QA scripts can consume the same contract or share the refreshed tokens or env.

## Dependencies
- `package.json`
- `scripts/portal-authenticated-canary.mjs`
- `scripts/credentials-health-check.mjs`
- `docs/runbooks/PORTAL_AUTOMATION_MATRIX.md`
- `docs/API_CONTRACTS.md`
- `docs/STAFF_CLAIMS_SETUP.md`
- `secrets/portal/`

## Verification
- helper command resolves credentials and reports redacted auth metadata
- existing authenticated canary can consume the refreshed auth contract
- emulator-only admin-token guidance remains absent from production auth output

## Completed In This Pass
1. Restored and exported shared portal credential normalization in `scripts/lib/firebase-auth-token.mjs` so scripts can parse the standard refresh-token bundle consistently.
2. Added `scripts/portal-auth-helper.mjs` and the `npm run portal:auth:helper` entry point for redacted operator auth bootstrap output.
3. Verified the helper against the live repo-local credential bundle and confirmed it reports email, UID, auth source, and token expiry without printing the raw bearer token.
