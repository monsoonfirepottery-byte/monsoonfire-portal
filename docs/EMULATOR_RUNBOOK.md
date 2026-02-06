# Emulator + Extensions Runbook

## Emulator startup (portal)
- Set env and start emulators from repo root:
  - `set VITE_USE_EMULATORS=true` (or PowerShell `$env:VITE_USE_EMULATORS="true"`)
  - `firebase emulators:start --config firebase.json --project monsoonfire-portal --only firestore,auth`
- Confirm ports:
  - Auth: `127.0.0.1:9099`
  - Firestore: `127.0.0.1:8080`
  - UI: `127.0.0.1:4000`

## Functions local dev
- `npm --prefix functions run build` (typecheck)
- Preferred (loads env from `functions/.env.local` every time):
  - `pwsh -File scripts/start-emulators.ps1`
- Equivalent direct command:
  - `firebase emulators:start --only firestore,functions,auth`
- Staff claims setup: `docs/STAFF_CLAIMS_SETUP.md`

### Stable local env across terminals
1. Copy `functions/.env.local.example` to `functions/.env.local`.
2. Set local-only values (for example `ADMIN_TOKEN`, `ALLOW_DEV_ADMIN_TOKEN=true`).
3. Start emulators via `pwsh -File scripts/start-emulators.ps1`.

This avoids losing env vars when opening a new terminal session.

## Required env for CORS allowlist
- `ALLOWED_ORIGINS` should include portal domains and dev origin.
  - Example: `http://localhost:5173,https://portal.monsoonfire.com,https://monsoonfire.com`

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
- **Auth emulator popup loop**: ensure emulator is running + `VITE_USE_EMULATORS=true`.
- **CORS blocked**: set `ALLOWED_ORIGINS` and redeploy functions.
- **Email extension deploy fails**: Firestore region mismatch (use `nam5`).
