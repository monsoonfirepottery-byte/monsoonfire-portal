# P1 — CI Smoke Failure: Firebase Emulator `--host` Flag Compatibility

Status: Closed
Date: 2026-03-01
Priority: P1
Owner: Platform / Tooling
Type: Incident + Documentation Closure

## Problem

`Smoke Tests / smoke` runs were failing early because emulator startup crashed with:

- `error: unknown option '--host'`

The failure path was `scripts/start-emulators.mjs`, which passed `--host` directly to `firebase emulators:start`. The Firebase CLI in our active environments (`15.6.0`) does not support that option.

## Root Cause

1. Startup script relied on CLI-level `--host`.
2. CLI option support drifted.
3. Host policy docs still implied CLI host-flag dependency.

## Fix Now (Implemented)

1. Updated emulator startup implementation:
   - `scripts/start-emulators.mjs`
   - Removed direct `firebase emulators:start --host ...`.
   - Added runtime config generation that injects `host` per selected emulator into a temporary `firebase.json`.
2. Updated docs to reflect behavior:
   - `docs/EMULATOR_RUNBOOK.md`
   - `docs/studiobrain-host-url-contract-matrix.md`

## Verification

1. `firebase emulators:start --help` confirms no `--host` option exists in active CLI.
2. `timeout 45s node ./scripts/start-emulators.mjs --no-network-check --no-contract-check --only auth`
   - Expected:
     - no `unknown option '--host'` error
     - runtime config path log appears
     - emulator reaches `All emulators ready`
3. Existing event-lane preflight remains green:
   - `npm run events:industry:check`

## Notes

- `start-emulators.mjs` still accepts `--host` as an input override; it is now mapped into runtime config host bindings rather than forwarded as a Firebase CLI flag.
- This closure addresses both code and docs to prevent recurrence.
