# Namecheap Portal Hosting (Apache) - Template

This folder contains a minimal `.htaccess` template for hosting the portal SPA on a Namecheap-style Apache shared host.

Goals:
- deep links do not 404 (SPA rewrite)
- `/.well-known/*` files are served as real files (no rewrite)
- hashed assets cache long; `index.html` stays fresh

## Deploy steps (typical)

1. Build the portal:
   - `npm --prefix web run build`
2. Upload the contents of `web/dist/` into the subdomain root for `portal.monsoonfire.com`.
3. Copy `web/deploy/namecheap/.htaccess` into that same subdomain root.
4. If using universal links/app links:
   - Ensure `/.well-known/` exists under the portal origin and contains the real AASA/assetlinks files.
5. Run the preflight verifier:
   - `pwsh web/deploy/namecheap/verify-cutover.ps1 -PortalUrl https://portal.monsoonfire.com`

## Notes

- The `.htaccess` rules are guarded by `<IfModule ...>` so they will no-op if the host disables the relevant Apache modules.
- If Namecheap is not Apache (or you are hosting on IIS/nginx), this file is not applicable.
- `verify-cutover.ps1` checks:
  - root route is reachable
  - deep link route returns HTML instead of 404
  - `/.well-known/*` can be read without SPA rewrite
  - cache headers on `index.html` and `/assets/*`
