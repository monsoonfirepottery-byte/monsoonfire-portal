# Hardening Failure-Mode Release Runbook

## Purpose

Provide a deterministic evidence workflow for the reliability-hardening controls introduced under
`P1-EPIC-13` so we can ship safely without relying on brittle manual checks.

## Scope

- Portal app error surfacing and recovery (`AppError`, `ErrorBanner`, `RootErrorBoundary`)
- Request capture and diagnostics (`safeStorage`, `requestTelemetry`, `functionsClient`, `portalApi`)
- Storage safety against runtime storage exceptions
- Website runtime banners and offline diagnostics surface

## CI / Local Commands

Run these checks before release:

```bash
npm run hardening:check
```

Optional:

```bash
npm --prefix web run test:run
npm run pr:gate
```

## Evidence Checklist

1. **Error model behavior**
   - `web/src/errors/appError.test.ts` passes.
   - `Auth`, `network`, and `firestore` messages are calm and include support codes.
2. **Request diagnostics**
   - `web/src/lib/requestTelemetry.test.ts` passes.
   - Last request capture and curl rendering remain redacted for user-facing panels.
3. **Storage resilience**
   - `web/src/lib/safeStorage.test.ts` passes (no throw on read/write/remove failures).
4. **Client runtime behavior**
   - Manual smoke walk:
     - trigger offline mode and confirm banner/retry path is visible.
     - trigger recoverable function error and confirm support code appears.
     - confirm blank-screen recovery path from `RootErrorBoundary`.

## Operator Notes

- Keep redaction on by default.
- If users report repeated retry loops, verify token/session headers and capture support code from banner before escalating.
- If a new Firestore index-related failure appears, point to `docs/runbooks/FIRESTORE_INDEX_TROUBLESHOOTING.md`.
