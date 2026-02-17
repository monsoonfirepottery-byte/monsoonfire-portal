# Monsoon Fire Portal — Agent Troubleshooting History

This document captures the recent failure chain we hit and the fixes that made the build/deploy pipeline stable.
Use this as a handoff for future agents and on-call staff.

## Current baseline

- Repository: `/home/wuff/monsoonfire-portal`
- Last known-good commits:
  - `1a70318a` — fixed web API import usage for function-name constants
  - `d4f3749d` — fixed Firebase `predeploy` commands for cross-platform deploy reliability
- `web` build/tests currently pass locally after fixes.

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

3. `npx firebase-tools deploy ... --only functions:websiteKilnBoard --only hosting` / PowerShell attempts produced inconsistent behavior.
   - Root cause: deploying command + predeploy parsing under Windows and outdated local code mismatch.
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
- Removes command-parser differences where CLI can incorrectly treat `npm --prefix ...` as a single executable token on Windows/Powershell during spawn.

## Commands that now work reliably (Windows PowerShell)

Set token:
```powershell
$env:FIREBASE_TOKEN="your-token"
```

Deploy only website backend function + hosting:
```powershell
npx firebase-tools deploy --project monsoonfire-portal --only functions:websiteKilnBoard,hosting --token $env:FIREBASE_TOKEN --non-interactive
```

Validate project context if needed:
```powershell
npx firebase-tools projects:list --token $env:FIREBASE_TOKEN
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

