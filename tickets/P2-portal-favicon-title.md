Status: Completed (2026-02-05)

# P2 - Portal branding polish: title + favicon

- Repo: web
- Area: UX polish / PWA
- Evidence:
  - `web/index.html` title is `web`
  - `web/vite.config.js` PWA `includeAssets` references `favicon.ico` but no such file exists in repo
- Recommendation:
  - Set `web/index.html` title to `Monsoon Fire Portal`
  - Add a real `web/public/favicon.ico` (or remove `favicon.ico` from `includeAssets` if intentionally unused)
- Fix applied:
  - Updated `web/index.html` title to `Monsoon Fire Portal`
  - Updated favicon to `pwa-192.png` and removed the missing `favicon.ico` from PWA `includeAssets`
- Effort: S
- Risk: Low
- What to test: `npm --prefix web run build`, PWA manifest still generated, browser tab shows correct title/icon.
