# Namecheap Portal Hosting (Apache) - Template

This folder contains a minimal `.htaccess` template for hosting the portal SPA on a Namecheap-style Apache shared host.

Goals:
- deep links do not 404 (SPA rewrite)
- `/.well-known/*` files are served as real files (no rewrite)
- hashed assets cache long; `index.html` stays fresh

## Deploy steps (typical)

1. Build the portal:
  - `npm --prefix web run build`

### Recommended automated deploy

From the repo root (works with a pre-built `web/dist`):

- `node ./scripts/deploy-namecheap-portal.mjs --server <cpanel-user>@<ip> --remote-path <docroot>/ --key ~/.ssh/namecheap-portal --verify`
- or with npm script:
  - `npm run deploy:namecheap -- --server <cpanel-user>@<ip> --remote-path <docroot>/ --key ~/.ssh/namecheap-portal --verify`
- or portal-target shortcut:
  - `npm run deploy:namecheap:portal -- --server <cpanel-user>@<ip> --key ~/.ssh/namecheap-portal`
- or live script shortcut (no-typo mode):
  - `npm run deploy:namecheap:portal:live -- --server <cpanel-user>@<ip> --key ~/.ssh/namecheap-portal`

Examples:

- `node ./scripts/deploy-namecheap-portal.mjs --server monsggbd@66.29.137.142 --remote-path portal/ --key ~/.ssh/namecheap-portal --verify`
- `node ./scripts/deploy-namecheap-portal.mjs --server monsggbd@66.29.137.142 --remote-path public_html/ --key ~/.ssh/namecheap-portal --verify`
- `npm run deploy:namecheap:portal -- --server monsggbd@66.29.137.142 --key ~/.ssh/namecheap-portal`
- `npm run deploy:namecheap:portal:quick -- --server monsggbd@66.29.137.142 --key ~/.ssh/namecheap-portal`
- `npm run deploy:namecheap:portal:live -- --server monsggbd@66.29.137.142 --key ~/.ssh/namecheap-portal`

Preferred multiline form (copy/paste safe):
```bash
npm run deploy:namecheap -- \
  --server monsggbd@66.29.137.142 \
  --port 21098 \
  --remote-path portal/ \
  --key ~/.ssh/namecheap-portal \
  --no-build \
  --verify \
  --portal-url https://portal.monsoonfire.com
```

If you already have the build on disk and do not need to rebuild:

- add `--no-build`.

The script:
- copies `web/dist` to a temporary staging directory,
- copies `web/deploy/namecheap/.htaccess` into staging root,
- `rsync --delete`s into the destination, and
- runs the optional cutover verifier (`--verify`).

### Manual fallback (legacy)

1. Build and upload the contents of `web/dist/` into the subdomain root for `portal.monsoonfire.com`.
2. Copy `web/deploy/namecheap/.htaccess` into that same subdomain root.
   - This template now includes a compatibility rewrite for hosts that do not serve hidden `.well-known` paths directly.
3. If using universal links/app links:
  - Ensure `/.well-known/` and `/well-known/` can be read and return the same JSON payload.
  - `web/build` now emits both directories for deploy safety.
5. Run the preflight verifier:
  - Primary path:
    - `node ./web/deploy/namecheap/verify-cutover.mjs --portal-url https://portal.monsoonfire.com --report-path docs/cutover-verify.json`
  - Optional protected-function auth verification (recommended close-out check):
    - `PORTAL_CUTOVER_ID_TOKEN="<REAL_ID_TOKEN>" node ./web/deploy/namecheap/verify-cutover.mjs --portal-url https://portal.monsoonfire.com --report-path docs/cutover-verify.json --require-protected-check true --functions-base-url https://us-central1-monsoonfire-portal.cloudfunctions.net --protected-fn listMaterialsProducts --protected-body '{"includeInactive":false}'`
    - Do not commit or log the raw ID token.
  - Compatibility fallback shim (optional):
    - `web/deploy/namecheap/verify-cutover -PortalUrl https://portal.monsoonfire.com -ReportPath docs/cutover-verify.json`

## Notes

- The `.htaccess` rules are guarded by `<IfModule ...>` so they will no-op if the host disables the relevant Apache modules.
- If Namecheap is not Apache (or you are hosting on IIS/nginx), this file is not applicable.
- `verify-cutover` checks:
  - root route is reachable
  - deep link route returns HTML instead of 404
  - `/.well-known/*` can be read without SPA rewrite
  - cache headers on `index.html`
  - sample `/assets/*` files for long-lived cache hints (`immutable` or high `max-age`)
  - optional protected function call with a provided ID token (`PORTAL_CUTOVER_ID_TOKEN` or `--id-token`)
