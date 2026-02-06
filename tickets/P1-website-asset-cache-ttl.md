Status: Completed (2026-02-05)

# P1 - Website `/assets` cache headers are too aggressive for non-hashed CSS/JS

- Repo: website
- Area: Performance / Release safety
- Evidence:
  - `website/web.config` sets 365-day cache for everything under `/assets`
  - website uses non-fingerprinted asset names (for example `/assets/css/styles.css`, `/assets/js/main.js`)
- Risk:
  - clients may keep stale CSS/JS for up to a year after deploy, causing broken layouts or behavior mismatches.
- Fix applied:
  - `website/web.config` now sets:
    - `/assets`: 1 hour cache TTL (covers css/js and other non-fingerprinted assets)
    - `/assets/images`: 365 day cache TTL
- Effort: M
- Risk: Med
- What to test: deploy a small CSS change and confirm clients pick it up immediately (hard refresh not required).
