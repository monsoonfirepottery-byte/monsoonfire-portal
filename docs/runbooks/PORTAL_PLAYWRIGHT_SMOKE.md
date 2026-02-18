# Portal Playwright Smoke Runbook

## Purpose
Run a browser-level verification of the production portal app with emphasis on failure modes we can only see in real browser runtime:
- Studio Brain integration points and localhost leak prevention
- CORS and blocked cross-origin requests
- Auth popup/window-opener noise (logged separately as warning notes)
- critical endpoint connectivity
- responsive render checks across desktop and mobile

The run writes:
- screenshots under `output/playwright/portal`
- `portal-smoke-summary.json` with every check, network event, screenshot reference, and failure detail

## Local usage
1. Install dependencies:
```bash
npm ci
```
2. Install Chromium for Playwright:
```bash
npm run portal:smoke:playwright:install
```
3. Run against local `localhost` dev URL or a local emulator:
```bash
node ./scripts/portal-playwright-smoke.mjs --base-url http://localhost:3000
```

Notes:
- On localhost targets, localhost Studio Brain references are tolerated to support local dev stacks.
- By default, the script stores artifacts under `output/playwright/portal`.

## Production usage
```bash
npm run portal:smoke:playwright:prod
```

### Deep mode
For browser-faithful regressions, run deep mode to execute explicit endpoint probes for:
- functions endpoints used by staff flows
- staff ops endpoints
- studio-brain readyz probe

```bash
npm run portal:smoke:playwright:deep
```

Deep mode also captures a live `readyz` request target from browser runtime. If the page is currently contacting a
`/readyz` endpoint, the script infers that target and probes it directly. If no target can be discovered (for example when staff
flows are not reached), `/readyz` probe is still recorded as skipped and non-authenticated auth-gated function responses are tolerated.

You can also pass custom endpoints explicitly:
```bash
node ./scripts/portal-playwright-smoke.mjs \
  --base-url https://monsoonfire-portal.web.app \
  --deep \
  --functions-base-url https://us-central1-monsoonfire-portal.cloudfunctions.net \
  --studio-brain-base-url https://monsoonfire-studio-brain.example.com \
  --output-dir output/playwright/portal/deep-prod
```

If you need endpoint probes to include explicit auth context:
```bash
node ./scripts/portal-playwright-smoke.mjs \
  --base-url https://monsoonfire-portal.web.app \
  --deep \
  --probe-bearer "$ID_TOKEN" \
  --probe-admin-token "$X_ADMIN_TOKEN" \
  --probe-credential-mode same-origin \
  --output-dir output/playwright/portal/deep-auth-prod
```

If you need to force the deep probe against an observed studio-brain local URL (for reproducing `127.0.0.1`/`localhost` regressions), pass it explicitly:
```bash
node ./scripts/portal-playwright-smoke.mjs \
  --base-url https://monsoonfire-portal.web.app \
  --deep \
  --studio-brain-base-url http://127.0.0.1:8787 \
  --probe-credential-mode same-origin \
  --output-dir output/playwright/portal/deep-local-studio-brain
```

For full browser parity (login-gated staff routes) run with real credentials:
```bash
node ./scripts/portal-playwright-smoke.mjs \
  --base-url https://monsoonfire-portal.web.app \
  --deep \
  --with-auth \
  --staff-email "$STAFF_EMAIL" \
  --staff-password "$STAFF_PASSWORD" \
  --probe-bearer "$ID_TOKEN" \
  --probe-admin-token "$X_ADMIN_TOKEN" \
  --probe-credential-mode same-origin \
  --output-dir output/playwright/portal/deep-authn
```

Equivalent environment variables are also supported:
- `PORTAL_SMOKE_PROBE_BEARER_TOKEN`
- `PORTAL_SMOKE_PROBE_ADMIN_TOKEN`
- `PORTAL_SMOKE_PROBE_CREDENTIAL_MODE` is the credential mode used by deep endpoint probes (`omit`, `same-origin`, `include`). `same-origin` matches browser-side fetch defaults from `web/src/api/functionsClient.ts`. Use:
  - `same-origin` for parity against production call behavior.
  - `include` when explicitly validating credentialed cross-origin behavior.
  - `omit` for anonymous preflight parity on static endpoint probes.

If you want to run against a different host:
```bash
node ./scripts/portal-playwright-smoke.mjs --base-url https://staging.example.com --output-dir output/playwright/portal-staging
```

## CI wiring
- `ci-smoke.yml` now runs `npm run test:automation` and uploads:
  - `portal-playwright-smoke` (`output/playwright/portal`)
  - `portal-playwright-smoke-deep` (`output/playwright/portal/deep`, only on manual deep dispatch)
  - `website-playwright-smoke` (`output/playwright`)
- `portal-prod-smoke.yml` runs production smoke from `--base-url ${{ github.event.inputs.base_url }}` and optionally deep mode when `run_deep_smoke=true`.

## Related repo scripts
- `npm run test:automation` (unit + functions CORS + a11y + portal/site Playwright smoke + bundle guard)
- `npm run test:automation:deep` (full automated suite + explicit production CORS base and deep portal probes)
- `npm run test:automation:bundle` (web build + localhost Studio Brain bundle leak guard)
- `npm run test:automation:ui:deep` (deep portal Playwright probes only)

## Failure triage
- `forbidden requests`:
  - Any requests to `127.0.0.1:8787` or `localhost:8787` on non-local base URLs.
  - This normally means Studio Brain endpoint has regressed to local host in production config.
- `CORS/bridge failures`:
  - Preflight/blocked fetch events to known production API endpoints.
  - Usually indicates missing `Access-Control-Allow-Origin` / auth CORS config in functions.
- `preflightRequests`:
  - Dedicated capture of OPTIONS/readyz-like cross-origin attempts with CORS request headers (`origin`, requested method/headers).
- `runtimeWarnings`:
  - Browser runtime notices (Firestore offline/reconnect chatter, expected auth popup flow notes, etc.) to aid debugging even when they are noise-filtered.
- `critical request failures`:
  - Request failures for critical Studio Brain/function endpoints (including request timeouts and net errors).
- `authPopupWarnings`:
  - `Cross-Origin-Opener-Policy` messages from Firebase popup auth; these are recorded as notes and are non-blocking.
- `critical response warnings`:
  - `5xx` responses on critical endpoints.

## Current portal checks
- `/` + dashboard
- `House`
- `Staff` when present for current auth
- `Messages`
- `Support`
- Mobile shell + basic dashboard touchpoint
- Deep mode: explicit endpoint probes for staff and studio-brain critical paths with auth-aware failure scoring
