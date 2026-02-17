Status: Completed

# P2 - Website CSP hash vs inline JSON-LD maintainability

- Repo: website
- Area: Security / SEO
- Evidence:
  - `website/web.config` uses a `script-src` hash
  - multiple pages embed inline JSON-LD via `<script type="application/ld+json">`
- Recommendation:
  - Externalize JSON-LD to a shared file loaded via `src="/assets/.../schema.json"` so CSP can rely on `'self'` (no per-page hashes), or confirm the hash is correct for the exact inline JSON-LD bytes across all pages and document the update procedure.
- Fix applied:
  - Added `website/assets/schema/localbusiness.json`.
  - Replaced inline JSON-LD blocks with `<script type="application/ld+json" src="/assets/schema/localbusiness.json"></script>` on the pages that used the inline block.
  - Removed the now-unneeded `script-src` hash from `website/web.config`.
- Effort: M
- Risk: Low
- What to test: load pages with browser console open and confirm no CSP violations; validate structured data via an SEO validator.
