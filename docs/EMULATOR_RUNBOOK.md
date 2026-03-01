# Emulator + Extensions Runbook

## Emulator startup (portal)
- Pre-start drift checks:
  - `npm run integrity:check`
  - `npm run studio:host:contract:scan:strict`
  - `npm run studio:emulator:contract:check:strict`
- Recommended: run Firestore + Functions emulators while using REAL Firebase Auth.
  - In `web/.env.local`:
    - `VITE_USE_AUTH_EMULATOR=false`
    - `VITE_USE_FIRESTORE_EMULATOR=true`
    - `VITE_FUNCTIONS_BASE_URL=http://127.0.0.1:5001/monsoonfire-portal/us-central1`
  - Canonical command:
    - `npm run emulators:start -- --only firestore,functions`
- Full local auth (use only when you specifically want emulated users/tokens):
  - In `web/.env.local`:
    - `VITE_USE_AUTH_EMULATOR=true`
    - `VITE_USE_FIRESTORE_EMULATOR=true`
    - `VITE_FUNCTIONS_BASE_URL=http://127.0.0.1:5001/monsoonfire-portal/us-central1`
  - Canonical command:
    - `npm run emulators:start -- --only firestore,auth,functions`
- Legacy toggle:
  - `VITE_USE_EMULATORS=true` is treated as a catch-all default for auth + firestore emulator wiring, but split flags are preferred for production-auth testing.
- Confirm ports:
  - Auth: `127.0.0.1:9099`
  - Firestore: `127.0.0.1:8080`
  - UI: `127.0.0.1:4000`

## Functions local dev
- `npm --prefix functions run build` (typecheck)
- Preferred (loads env from `functions/.env.local` every time):
  - `node ./scripts/start-emulators.mjs --only firestore,functions,auth`
- Optional host/profile override:
  - `STUDIO_BRAIN_NETWORK_PROFILE=local|lan-static|lan-dhcp|ci`
  - `STUDIO_BRAIN_STATIC_IP=<optional_static_ipv4_for_lan_static>`
  - `node ./scripts/start-emulators.mjs --network-profile lan-dhcp --only firestore,functions,auth`
- Optional preflight before startup:
  - `npm run studiobrain:network:check -- --json`
  - `npm run studio:network:check -- --json`
  - `npm run studio:network:check:write-state`
- Equivalent direct command:
  - `node ./scripts/start-emulators.mjs --only firestore,functions,auth`
- Optional compatibility path (legacy / compatibility-only):
  - `node ./scripts/ps1-run.mjs scripts/start-emulators.ps1`
- Staff claims setup: `docs/STAFF_CLAIMS_SETUP.md`

### Stable local env across terminals
1. Copy `functions/.env.local.example` to `functions/.env.local`.
2. Copy `web/.env.local.example` to `web/.env.local`.
3. Choose profile mode in `web/.env.local`:
  - keep emulator toggles off for production-targeted local work, or
  - enable emulator toggles and set host/base URLs for either loopback or LAN/static profile.
4. Set local-only values (for example `ADMIN_TOKEN`, `ALLOW_DEV_ADMIN_TOKEN=true`).
5. Verify env readiness before startup:
  - `npm run studio:env:verify`
6. Start emulators via canonical command: `npm run emulators:start -- --only firestore,functions,auth`.
  - `scripts/start-emulators.mjs` now runs emulator contract validation first (`scripts/validate-emulator-contract.mjs --strict`), then network gate checks.
  - Host bindings are applied through a generated runtime Firebase config file so startup is compatible with Firebase CLI builds that do not support `firebase emulators:start --host`.
  - Optional bypasses (debug only): `--no-contract-check`, `--no-network-check`.
  - Optional compatibility fallback: `node ./scripts/ps1-run.mjs scripts/start-emulators.ps1`.

## Emulator and UI contract matrix

Use this matrix when setting `web` env values for deterministic smoke and onboarding behavior:

| Target | Variable / Value | Notes |
| --- | --- | --- |
| Auth emulator host | `VITE_AUTH_EMULATOR_HOST` | `127.0.0.1` (or `studiobrain.local` for LAN-aware flows) |
| Auth emulator port | `VITE_AUTH_EMULATOR_PORT` | `9099` |
| Firestore emulator host | `VITE_FIRESTORE_EMULATOR_HOST` | `127.0.0.1` (or `studiobrain.local` for LAN-aware flows) |
| Firestore emulator port | `VITE_FIRESTORE_EMULATOR_PORT` | `8080` |
| Functions host mode | `VITE_USE_AUTH_EMULATOR`, `VITE_USE_FIRESTORE_EMULATOR`, `VITE_USE_EMULATORS` | Prefer split flags for stable workflows |
| Functions API base | `VITE_FUNCTIONS_BASE_URL` | `http://127.0.0.1:5001/monsoonfire-portal/us-central1` |
| Studio Brain base | `STUDIO_BRAIN_BASE_URL` | Derived from `STUDIO_BRAIN_NETWORK_PROFILE` via `scripts/studio-network-profile.mjs` |

When testing from another device, align host fields with the active Studiobrain network profile:

- `local` profile: loopback defaults (`127.0.0.1` + localhost aliases).
- `lan-dhcp`/`lan-static`: host values should use the LAN hostname (example: `studiobrain.local`) and `npm run studio:network:check` should reflect the active profile.

This avoids losing env vars when opening a new terminal session.

## Command matrix

| Profile | Primary command | Purpose |
| --- | --- | --- |
| local loopback | `npm run emulators:start -- --network-profile local --only firestore,functions,auth` | Default local workstation flow |
| deep local | `npm run emulators:start -- --network-profile local --only firestore,functions,auth` + `npm run portal:smoke:playwright:local:deep` | Local browser + deep endpoint probes |
| CI | `npm run emulators:start -- --network-profile ci --only firestore,functions,auth` | Deterministic CI-hosted emulator profile |

## Smoke matrix

| Profile | Smoke command | Must verify |
| --- | --- | --- |
| local loopback | `npm run portal:smoke:playwright:local` | Portal renders, core API calls reachable |
| deep local | `npm run portal:smoke:playwright:local:deep` | `/readyz` and deep API probes recorded |
| production check | `npm run portal:smoke:playwright:prod` | No localhost leakage, production targets only |

## Fallback rules when emulators are not running

1. If emulator mode flags are enabled but emulator contract check fails, do not continue smoke until mismatch is fixed.
2. If local emulators are intentionally unavailable, disable emulator flags in `web/.env.local`:
   - `VITE_USE_AUTH_EMULATOR=false`
   - `VITE_USE_FIRESTORE_EMULATOR=false`
   - `VITE_USE_EMULATORS=false`
3. Keep `VITE_FUNCTIONS_BASE_URL` pointed to a reachable non-loopback endpoint when running non-emulator flows.
4. Re-run `npm run studio:emulator:contract:check:strict` before smoke.

## Vite host and proxy smoke checklist

Use this checklist before local portal smoke runs when host/profile settings changed:

1. Start Vite on the canonical host/port contract:
   - `npm --prefix web run dev`
   - expected: `http://127.0.0.1:5173` (or profile-specific host with explicit `VITE_PORT`)
2. Verify stack profile gate (host + proxy targets):
   - `npm run studio:stack:profile:snapshot:strict -- --json`
3. Verify Vite proxy rewrites are reaching backend targets (not Vite index fallback):
   - `curl -i http://127.0.0.1:5173/__studio-brain/readyz`
   - `curl -i http://127.0.0.1:5173/__functions/__proxy_contract_probe__`
4. Run browser smoke against local Vite host with deep endpoint probes:
   - `npm run portal:smoke:playwright:local:deep`

Acceptable backend status codes for proxy checks depend on auth/runtime state (`200`, `401`, `403`, `404`, `5xx`), but responses should come from backend targets rather than the Vite HTML shell.

## Network profile health and host stability
- Validate host identity and profile drift before smoke or deployment workflows:
  - `npm run studio:host:contract:scan:strict`
  - `npm run studio:host:contract:evidence`
  - `npm run studio:emulator:contract:check:strict`
  - `npm run studio:network:check:gate -- --strict`

### Stack profile evidence capture
- Before onboarding or cutover handoffs, capture a stack profile snapshot for reproducible evidence:
  - `npm run studio:stack:profile:snapshot`
  - `npm run studio:stack:profile:snapshot:strict`
  - capture artifact: `output/studio-stack-profile/latest.json`
- Use profile-aware emulator bootstrap command when host strategy changes:
  - `npm run emulators:start -- --network-profile local --only firestore,functions,auth`
  - `npm run emulators:start -- --network-profile lan-dhcp --only firestore,functions,auth`
  - `npm run emulators:start -- --network-profile lan-static --only firestore,functions,auth`
- Recommended sequence before major cutover changes:
  - `npm run studio:host:contract:scan:strict`
  - `npm run studio:check:safe`
  - `npm run studio:network:check:gate -- --strict`
  - `npm run guardrails:check -- --strict`
  - `npm run studio:cutover:gate -- --no-smoke`
  - `npm run studio:cutover:gate -- --portal-deep` (or `npm run studio:cutover:gate -- --portal-deep --portal-base-url https://monsoonfire-portal.web.app` for production-aligned API target)
  - `npm run integrity:check`

#### Expected runtime (cutover gate)
- `npm run studio:cutover:gate -- --no-smoke`: usually 20-90 seconds when services are already up.
- `npm run studio:cutover:gate -- --portal-deep`: usually 2-6 minutes depending on network and Playwright browser startup.
- Degraded path expectation:
  - blocking dependency failure (Postgres/Redis/MinIO/status gate) should fail in under 90 seconds.
  - portal/website smoke failures typically surface in 1-4 minutes with artifacts in `output/cutover-gate/`.

### Stability resource guardrails

Run this when a local Studiobrain instance has been up for multiple cycles, before cutover handoff, or after large smoke batches:

```bash
npm run guardrails:check
npm run guardrails:check -- --strict
npm run guardrails:check -- --cleanup --cleanup-days 14
```

The guardrails command checks:
- compose service guardrails (restart/logging/deploy limits in `studio-brain/docker-compose.yml`)
- output artifacts (`output/playwright`, `output/stability`, `output/cutover-gate`, `output/pr-gate`)
- docker volume size (`postgres_data`, `minio_data`)
- Studiobrain container log size

## Deployment gate and evidence

Before major cutover handoffs, run the full deployment gate matrix:

```bash
npm run source:truth:deployment -- --phase all --strict --json --artifact output/source-of-truth-deployment-gates/emulator-pass.json
```

If the gate fails:
- `staging`/`production` failures: check referenced workflow and runbook files in the printed finding.
- `beta` failures: verify `docs/studiobrain-host-url-contract-matrix.md` and `docs/EMULATOR_RUNBOOK.md` reflect active LAN profile expectations.
- `store-readiness` failures: verify deep-link and `.well-known` doc parity, then rerun this step.

Attach the generated artifact path to handoff notes so release staff can replay the same checks.

### Cutover residency check
- Optional command loop for long-lived Studiobrain operations:
  - `npm run reliability:once` (single pass)
  - `npm run reliability:watch -- --interval-ms 60000`
  - `npm run reliability:report`
  - `npm run house:status`
  - `npm run house:watch`
  - `npm run house:report`
  - `npm run incident:bundle` (capture diagnostics when status is red)
  
Recommended clean-state definition:
- host contract scan passes (`npm run studio:host:contract:scan:strict`)
- status gate passes (`npm run studio:check:safe`)
- smoke checks pass (`npm run studio:cutover:gate`)
- runtime integrity check passes (`npm run integrity:check`)

## Network profile and DHCP/static-host strategy

Set one profile from `studio-brain/.env.network.profile` and keep it consistent across
emulator startup, smoke, and status checks:

- `local` (default): loopback for on-device work (`127.0.0.1`).
- `lan-dhcp`: use `studiobrain.local` for remote LAN workflows when static IP is not guaranteed.
- `dhcp-host`: alias of `lan-dhcp` when you want explicit fallback naming in profile files.
- `lan-static`: hard-bind StudioBrain to `STUDIO_BRAIN_STATIC_IP`.

### DHCP-only host recovery
1. Keep this in `studio-brain/.env.network.profile`:
   - `STUDIO_BRAIN_NETWORK_PROFILE=lan-dhcp` (or `dhcp-host`)
   - `STUDIO_BRAIN_LAN_HOST=studiobrain.local` (or your local hostname)
   - optional explicit fallback: `STUDIO_BRAIN_DHCP_HOST=studiobrain.local`
2. Run:
   - `npm run studio:network:check:write-state`
3. If host drift is reported:
   - verify router or local DNS for the host name
   - confirm `.studiobrain-host-state.json` and rerun the network check
   - switch temporarily to `local` to recover if needed, then restore LAN profile.

### Static-IP governance and ownership

Use this when the LAN host should stay stable across reboots and router churn:

1. Set profile to static mode:
   - `STUDIO_BRAIN_NETWORK_PROFILE=lan-static`
2. Set ownership details in `studio-brain/.env.network.profile`:
   - `STUDIO_BRAIN_STATIC_IP=<reserved_ipv4>` (required)
   - `STUDIO_BRAIN_LAN_HOST=<dns_or_mdns_hostname>` (optional, for readability)
   - current static LAN assignment: `192.168.1.226`
3. Keep the static assignment ownership list current in operations docs:
   - Owner: primary platform operator
   - Review cadence: when router firmware or VLAN changes are made
4. Validate and persist governance evidence:
   - `npm run studio:network:check -- --json`
   - `npm run studio:network:check:write-state -- --strict`

Recovery path when static governance breaks:

1. Flip `STUDIO_BRAIN_NETWORK_PROFILE=local` to regain local control.
2. Confirm static DHCP/route state in router and host file mapping for `studiobrain.local`.
3. Update `STUDIO_BRAIN_STATIC_IP` only after validation.
4. Run the write-state gate above before resuming remote workflows.

### Optional static IP path
1. Reserve a stable IP on your router for the Studiobrain host.
2. Set in `studio-brain/.env.network.profile`:
   - `STUDIO_BRAIN_NETWORK_PROFILE=lan-static`
   - `STUDIO_BRAIN_STATIC_IP=<reserved_ipv4>`
3. Validate profile and persistence:
   - `npm run studio:network:check -- --json`
   - `npm run studio:network:check:write-state`
4. Proceed with emulator + smoke commands under that profile.

### Golden target profile checklist (PR review + pair handoff)

Use this checklist before cutover reviews and when handing off the active Studiobrain host:

1. Profile is explicit and intentional in `studio-brain/.env.network.profile`:
   - `STUDIO_BRAIN_NETWORK_PROFILE=local|lan-dhcp|lan-static`
2. Quick host contract check passes:
   - `npm run studiobrain:network:check -- --json`
3. Host state is persisted for drift detection:
   - `npm run studiobrain:network:check:write-state -- --strict`
4. Drift gate is green before smoke/cutover:
   - `npm run studiobrain:network:check:gate -- --strict`
5. If `lan-static` is selected, router reservation + `STUDIO_BRAIN_STATIC_IP` match the same IPv4.
6. PR evidence includes:
   - `output/studio-network-check/pr-gate.json` or `output/studio-network-check/cutover-gate.json`
   - `output/studio-stack-profile/latest.json`
   - `output/host-contract-evidence/latest.json`

## Backup And Restore Drill Commands

Use these before major cutover handoffs or after infrastructure changes:

```bash
npm run backup:verify
npm run backup:verify:freshness
npm run backup:restore:drill
```

Artifacts:
- `output/backups/<timestamp>/manifest.json`
- `output/backups/<timestamp>/restore-drill-summary.json`
- `output/backups/latest.json`

## Runtime Contract Docs Generation

Keep generated runtime docs in sync with env/network contract sources:

```bash
npm run docs:contract
npm run docs:contract:check
```

Generated artifact:
- `docs/generated/studiobrain-runtime-contract.generated.md`

## Required env for CORS allowlist
- `ALLOWED_ORIGINS` should include portal domains and dev origin.
  - Example: `http://localhost:5173,https://portal.monsoonfire.com,https://monsoonfire.com,https://monsoonfire-portal.web.app,https://monsoonfire-portal.firebaseapp.com`

## Email extension (firestore-send-email)
- Firestore region is **nam5**. Extension must match:
  - `DATABASE_REGION=nam5`
  - `firebaseextensions.v1beta.function/location=nam5`
- Collection: `mail`

### Smoke test
1) Add a doc in `/mail` with:
   - `to`: recipient email
   - `message`: { `subject`, `text` }
2) Confirm the extension updates status fields.

## Common errors
- **No emulators to start**: `firebase.json` missing or config not loaded.
- **Auth popup loop / immediate sign-out**:
  - if you are testing REAL auth, ensure `VITE_USE_AUTH_EMULATOR=false` and remove any leftover `VITE_USE_EMULATORS=true` from `web/.env.local`.
  - if you are intentionally using the Auth emulator, ensure it is running on `127.0.0.1:9099`.
- **CORS blocked**: set `ALLOWED_ORIGINS` and redeploy functions.
- **Email extension deploy fails**: Firestore region mismatch (use `nam5`).
