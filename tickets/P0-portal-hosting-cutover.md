# P0 - Portal Hosting Cutover (portal.monsoonfire.com)

Status: Blocked

Goal: ship the portal at `https://portal.monsoonfire.com` on Namecheap hosting, with working Firebase Auth + Cloud Functions calls, and the correct static hosting behavior for a SPA.

## Problem

The portal is currently a Vite SPA and expects:
- correct SPA routing (deep links do not 404)
- correct cache headers (hash assets long-cache; HTML short-cache)
- correct CORS/origin behavior for Cloud Functions
- correct Firebase Auth "authorized domains" and OAuth redirect alignment

If any of these are off, we get login loops, broken routes, or silent failures that will be painful to debug during alpha.

## Repo Assets

- Apache SPA + cache template: `web/deploy/namecheap/.htaccess`
- Notes: `web/deploy/namecheap/README.md`

## Tasks

- DNS
  - Create `portal.monsoonfire.com` record(s) pointing to hosting target.
  - Ensure HTTPS works (valid cert; redirects HTTP -> HTTPS).
- Portal deploy behavior
  - Decide deployment artifact location (recommended: `web/dist` upload).
  - Confirm server rewrite rules:
    - all non-file routes -> `/index.html` (SPA)
    - `/.well-known/*` served as static files (no rewrite)
- Caching
  - `index.html`: short cache (or no-cache)
  - `/assets/*` hashed files: long cache (immutable)
- Firebase Auth config
  - Add `portal.monsoonfire.com` to Firebase Auth "Authorized domains".
  - Confirm Google sign-in works from `https://portal.monsoonfire.com`.
  - If introducing an auth handler domain (recommended for multi-provider): follow `docs/AUTH_DOMAIN_SETUP.md`.
- Functions/origin verification
  - Confirm CORS allowlist includes `https://portal.monsoonfire.com` (code already supports this in `functions/src/shared.ts`).
  - Smoke test: a protected Cloud Function call succeeds with `Authorization: Bearer <idToken>`.
- Evidence
  - Capture: URL + screenshot + one successful auth + one successful function call (no tokens in git).

## Acceptance

- `https://portal.monsoonfire.com` loads on desktop + mobile.
- Refresh on a deep route does not 404 (SPA rewrite works).
- `/.well-known/*` is served from the portal origin when present.
- Google sign-in works and does not loop back to the sign-in panel.
- At least one protected Cloud Function call succeeds from the hosted portal.

## Dependencies / Notes

- Requires Namecheap hosting panel + DNS access.
- Provider secrets (Apple/Microsoft/Facebook) are separate: `tickets/P1-prod-auth-oauth-provider-credentials.md`.

## Update (2026-02-12)
- Added preflight validation script: `web/deploy/namecheap/verify-cutover.ps1`.
- Updated deploy guide with verification step + expected checks in `web/deploy/namecheap/README.md`.
- Expanded verifier to sample built `/assets/*` cache headers and optional JSON report output via `-ReportPath`.
- Attempted verifier run from dev environment and received `No such host is known` for `portal.monsoonfire.com`; indicates DNS/cutover not active yet (external blocker).
- Added orchestration helper: `scripts/run-external-cutover-checklist.ps1` to generate a one-command execution checklist and run verifier automatically when DNS resolves.
- Remaining work is external-console execution (DNS/HTTPS/Auth domain checks/evidence capture).

## Prior Blocker (Cleared 2026-02-13)
- Requires DNS/hosting-panel changes and HTTPS certificate provisioning for `portal.monsoonfire.com`.
- Current environment cannot perform Namecheap hosting control-panel actions.

## Update (2026-02-13)
- Hosting + SSL are now live for `https://portal.monsoonfire.com`.
- Verification run succeeded:
  - Root route: `200`
  - Deep link `/reservations`: `200` with HTML app shell
  - Sample `/assets/*.js` responses: `200` with long-lived cache headers (`max-age=691200`)
- Evidence written to `docs/cutover-verify.json`.
- Remaining close-out items:
  - Confirm hosted Google sign-in end-to-end.
  - Capture one successful protected Cloud Function call from hosted portal.
- `/.well-known/apple-app-site-association` currently returns `404` (warning only unless universal links are required in this phase).

## Update (2026-02-23)
- Extended cutover verifier to support optional authenticated protected-function checks:
  - `web/deploy/namecheap/verify-cutover.mjs`
  - `web/deploy/namecheap/verify-cutover.ps1` (compat shim)
- Updated deploy docs/checklist to include authenticated verification path and token-handling guardrails:
  - `web/deploy/namecheap/README.md`
  - `scripts/run-external-cutover-checklist.mjs`
  - `docs/EXTERNAL_CUTOVER_EXECUTION.md`
- Refreshed current static-route verifier evidence:
  - `docs/cutover-verify.json` (currently failing because `/.well-known/apple-app-site-association` returns `404`)
- Captured explicit required-check failure evidence when no token is provided:
  - `docs/cutover-verify-auth-required.json`

## Current Blocker (2026-02-23)
- Ticket close-out still requires a real hosted auth session token to satisfy acceptance:
  1. hosted Google sign-in pass on `https://portal.monsoonfire.com`
  2. one successful protected Cloud Function call using `--require-protected-check true`
- This cannot be completed fully from repo-only automation without operator-supplied production ID token/session.
