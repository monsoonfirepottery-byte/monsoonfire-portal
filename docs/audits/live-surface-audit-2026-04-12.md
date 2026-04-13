# Live Surface Audit Notes — 2026-04-12

## Access check from this environment
- `curl -I https://monsoonfire.com` returned `HTTP/1.1 403 Forbidden`.
- `curl -I https://portal.monsoonfire.com` returned `HTTP/1.1 403 Forbidden`.
- Headless Playwright browser installation was attempted (`npx playwright install chromium`) and failed due CDN `403 Forbidden`, so direct rendered visual verification could not be completed from this runner.

## Website evidence sampled from repository source
- Homepage login points to `https://portal.monsoonfire.com`.
- Several other pages still point login to `https://monsoonfire.kilnfire.com`.
- Homepage includes loading placeholders for kiln status and updates.
- Kiln status data file reports `lastUpdated: 2026-01-31 5:30 PM`.

## Portal evidence sampled from repository source
- Main nav currently groups areas into Kiln Rentals, Studio & Resources, Community.
- Unknown routes fall back to generic `PlaceholderView` that says "Coming soon. We are designing this area next."
- `WareCheckInView` currently re-exports `ReservationsView`.
