# P0 - Portal Hosting Cutover (portal.monsoonfire.com)

Status: Planned

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
