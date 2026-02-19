# Monsoon Fire Portal — Agent Troubleshooting History

This document captures the recent failure chain we hit and the fixes that made the build/deploy pipeline stable.
Use this as a handoff for future agents and on-call staff.

## Current baseline

- Repository: `/home/wuff/monsoonfire-portal`
- Last known-good commits:
  - `1a70318a` — fixed web API import usage for function-name constants
  - `d4f3749d` — fixed Firebase `predeploy` commands for cross-platform deploy reliability
  - `web` build/tests currently pass locally after fixes.

## Consistency and history notes (2026-02-18)

- This branch was intentionally rewritten for a clean history before finalization.
- A temporary PR merge flow was used (`PR #13`), then `main` was force-updated with a single squash commit:
  - `760dc0d9` (`chore(portal): complete remaining TODOs and add single-glaze tile mode`)
- The resulting history is now linear from `99842e97` with a single post-deploy feature commit on `main`.
- Prior intermediate commit chain was preserved for recovery on local branch:
  - `backup/portal-history-preclean`
- PR #13 now has a follow-up comment documenting this rewrite for audit traceability.

## Deployment history (recent)

1. `playwright install` on Ubuntu was failing with missing legacy host packages:
   - `libxml2` and `libicu74` package lookup problems.
   - Workaround used at the time: install newer equivalents and symlink compatibility names.
   - Note: this is environment-specific and was only relevant to the dev shell, not app code.

2. `npm run test:functions` surfaced many TypeScript errors across `functions/` (mostly safety-nullability and request typing):
   - `src/apiV1.ts`: `safeString(..., null)` needed type-safe handling.
   - `assignReservationStation.ts`: request context properties (`__mfAuthContext`, `__mfAuth`) were not declared on `Request`.
   - `updateReservation.ts`: mismatch between `string | null` and typed `ReservationStatus` / `LoadStatus`.
   - These were resolved in the earlier commit series culminating in `0c91e4f0`.

3. `npx firebase-tools deploy ... --only functions:websiteKilnBoard --only hosting` / legacy shell attempts produced inconsistent behavior.
  - Root cause: deploying command + predeploy parsing under legacy shells and outdated local code mismatch.
   - Initial function deploy prechecks passed after auth/session issues were resolved, then:
     - `TS1361: cannot be used as a value because it was imported using 'import type'`
     - `hosting predeploy` failure: `spawn npm --prefix web run build ENOENT`.

## What was fixed in `d4f3749d`

- `package.json` (repo root)
  - Added scripts:
    - `build:web` = `npm --prefix web run build`
    - `build:functions` = `npm --prefix functions run build`
- `firebase.json`
  - `functions[0].predeploy`: changed from `npm --prefix "$RESOURCE_DIR" run build` to `npm run build:functions`
  - `hosting.predeploy`: changed from `npm --prefix web run build` to `npm run build:web`

Why this helps:
- Removes command-parser differences where CLI can incorrectly treat `npm --prefix ...` as a single executable token during spawn.
- If deployment stalls at:
  `User code failed to load. Cannot determine backend specification. Timeout after 10000...`
  - raise discovery timeout before redeploying:
    - `FUNCTIONS_DISCOVERY_TIMEOUT` (seconds) = `120` is a good first value.

## Commands that now work reliably (cross-platform shells)

Set token:
```bash
export FIREBASE_TOKEN="your-token"
```

Deploy only website backend function + hosting:
```bash
export FUNCTIONS_DISCOVERY_TIMEOUT="120"
npx firebase-tools deploy --project monsoonfire-portal --only functions:websiteKilnBoard,hosting --token "$FIREBASE_TOKEN" --non-interactive
```
If you only need functions right now:
```bash
export FUNCTIONS_DISCOVERY_TIMEOUT="120"
npx firebase-tools deploy --project monsoonfire-portal --only functions:websiteKilnBoard --token "$FIREBASE_TOKEN" --non-interactive
```

Validate project context if needed:
```bash
npx firebase-tools projects:list --token "$FIREBASE_TOKEN"
```

Optional local checks before deploy:
```bash
npm run build:web
npm run build:functions
npm --prefix web run test:run
```

## Repeatable troubleshooting map

- If you see `TS1361 ... imported using 'import type'` in `web` build:
  - Pull latest `main` and confirm `web/src/api/portalApi.ts` imports those constants as values.
  - Confirm `git log` includes `1a70318a` (or later).

- If deploy says `No function matches the filter`:
  - Ensure using comma-delimited single `--only` value:
    - `--only functions:websiteKilnBoard,hosting`
  - Don’t pass duplicate `--only` flags in a way your CLI version parses incorrectly.

- If deploy errors with `401`:
  - Token likely stale/invalid despite being present in env.
  - Retry token, or move to service-account auth in longer term.

- If predeploy fails with `ENOENT` again:
  - Confirm `firebase.json` points to `npm run build:web` and `npm run build:functions`.
  - Confirm those scripts exist in root `package.json` after checkout.

## Known risk notes

- The local machine has had repeated auth-tooling mismatch with `FIREBASE_TOKEN` deprecation warnings.
- If you switch teams/OS, force a clean git pull from this repo before deploy.
- Always keep `web/dist` generation/redeploy under `npm run build:web` to avoid stale output.

## Session follow-up: recent house-level and deploy iteration

- `HouseView` was introduced as a new top-level staff-facing surface in the portal shell, with:
  - role-aware access states (`isHouseManager`, `isHouseMember`, `isHouseGuest`)
  - Studio Brain read-through embedded under the house shell
  - read-only mode for non-manager house users
  - `StaffView` now excludes Studio Brain direct mounting so controls stay centralized under House.
- `StudioBrainModule` was hardened with explicit read-only support:
  - refresh remains available in read-only mode
  - write actions stay disabled without admin token
  - table row cap removal was removed for many read-only dashboards so managers can view full history payloads.
- `web/src/views/staff/StudioBrainModule.test.tsx` now includes read-only coverage for house/member flows and stable selectors for text that previously duplicated.

## Practical testing endpoints to verify after each handoff

- Production app: `https://monsoonfire-portal.web.app`
- Firebase Hosting fallback: `https://monsoonfire-portal.firebaseapp.com`
- Local Firebase hosting emulator: `http://127.0.0.1:5000`
- Local Vite dev server: `http://localhost:5173`
- Function endpoint: `https://us-central1-monsoonfire-portal.cloudfunctions.net/websiteKilnBoard`

## Host-side command reminders

- If browser shows CORS errors like `No 'Access-Control-Allow-Origin' header` against
  `https://us-central1-monsoonfire-portal.cloudfunctions.net/...` from
  `https://monsoonfire-portal.web.app`, verify both are set:
  - `ALLOWED_ORIGINS` includes `https://monsoonfire-portal.web.app` and
    `https://monsoonfire-portal.firebaseapp.com` for Functions.
  - `STUDIO_BRAIN_ALLOWED_ORIGINS` includes the same domains for Studio Brain server.
- If you still see calls to `http://127.0.0.1:8787` from the production web origin,
  set `VITE_STUDIO_BRAIN_BASE_URL` in the web app environment/build for that deployment.

- Set token once per session:
  - `export FIREBASE_TOKEN="563584335869-..."`
- Validate access before deploy:
  - `npx firebase-tools projects:list --token "$FIREBASE_TOKEN"`
- If deploy fails with discovery timeout, set timeout and use this deploy pattern:
- `npx firebase-tools deploy --project monsoonfire-portal --only functions:websiteKilnBoard,hosting --token "$FIREBASE_TOKEN" --non-interactive`
- If deploy fails with `401`:
  - check token freshness
  - rerun `projects:list` with the same token
  - retry with freshly copied token from browser login flow

## Shell-specific gotchas observed

- `export` is not a legacy shell assignment command on all environments.
- Use shell-native environment assignment for your shell (`export`, `$env:VAR = "..."`, etc.).
- `--project` must receive a value; missing alias/id produces parser errors before auth can begin.
- `npx firebase-tools deploy --only functions:websiteKilnBoard --only hosting` can trigger parsing ambiguities.
  - Prefer one combined `--only` list string, for example:
    - `--only "functions:websiteKilnBoard,hosting"`
- If you still hit `No function matches the filter`:
  - recheck function export name in `functions/src/index.ts`
  - ensure the codebase is built and deployed after the last pull
