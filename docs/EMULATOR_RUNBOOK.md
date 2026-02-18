# Emulator + Extensions Runbook

## Emulator startup (portal)
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
  - `npm run studio:network:check -- --json`
  - `npm run studio:network:check:write-state`
- Equivalent direct command:
  - `node ./scripts/start-emulators.mjs --only firestore,functions,auth`
- Legacy compatibility shim (PowerShell):
  - `pwsh -File scripts/start-emulators.ps1`
- Staff claims setup: `docs/STAFF_CLAIMS_SETUP.md`

### Stable local env across terminals
1. Copy `functions/.env.local.example` to `functions/.env.local`.
2. Set local-only values (for example `ADMIN_TOKEN`, `ALLOW_DEV_ADMIN_TOKEN=true`).
3. Start emulators via `npm run emulators:start -- --only firestore,functions,auth`.
   - Compatibility fallback: `pwsh -File scripts/start-emulators.ps1`.

This avoids losing env vars when opening a new terminal session.

## Network profile health and host stability
- Validate host identity and profile drift before smoke or deployment workflows:
  - `npm run studio:network:check:gate -- --strict`
- Recommended sequence before major cutover changes:
  - `npm run studio:network:check:gate -- --strict`
  - `npm run studio:check`
  - `npm run pr:gate -- --smoke`

## Network profile and DHCP/static-host strategy

Set one profile from `studio-brain/.env.network.profile` and keep it consistent across
emulator startup, smoke, and status checks:

- `local` (default): loopback for on-device work (`127.0.0.1`).
- `lan-dhcp`: use `studiobrain.local` for remote LAN workflows when static IP is not guaranteed.
- `lan-static`: hard-bind StudioBrain to `STUDIO_BRAIN_STATIC_IP`.

### DHCP-only host recovery
1. Keep this in `studio-brain/.env.network.profile`:
   - `STUDIO_BRAIN_NETWORK_PROFILE=lan-dhcp`
   - `STUDIO_BRAIN_LAN_HOST=studiobrain.local` (or your local hostname)
2. Run:
   - `npm run studio:network:check:write-state`
3. If host drift is reported:
   - verify router or local DNS for the host name
   - confirm `.studiobrain-host-state.json` and rerun the network check
   - switch temporarily to `local` to recover if needed, then restore LAN profile.

### Optional static IP path
1. Reserve a stable IP on your router for the Studiobrain host.
2. Set in `studio-brain/.env.network.profile`:
   - `STUDIO_BRAIN_NETWORK_PROFILE=lan-static`
   - `STUDIO_BRAIN_STATIC_IP=<reserved_ipv4>`
3. Validate profile and persistence:
   - `npm run studio:network:check -- --json`
   - `npm run studio:network:check:write-state`
4. Proceed with emulator + smoke commands under that profile.

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
