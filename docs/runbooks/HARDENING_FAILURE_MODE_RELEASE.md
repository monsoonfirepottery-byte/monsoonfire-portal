# Hardening Failure-Mode Release Runbook

## Purpose

Provide a deterministic evidence workflow for the reliability-hardening controls introduced under
`P1-EPIC-14` so we can ship safely without relying on brittle manual checks.

## Scope

- Portal app error surfacing and recovery (`AppError`, `ErrorBanner`, `RootErrorBoundary`)
- Request capture and diagnostics (`safeStorage`, `requestTelemetry`, `functionsClient`, `portalApi`)
- Storage safety against runtime storage exceptions
- Website runtime banners and offline diagnostics surface

## CI / Local Commands

Run these checks before release:

```bash
npm run hardening:check
npm --prefix web run build
```

Optional:

```bash
npm --prefix web run test:run
npm run pr:gate
npm run portal:smoke:playwright -- --output-dir output/playwright/portal/hardening
```

## Evidence Checklist

1. **Error model behavior**
   - `web/src/errors/appError.test.ts` passes.
   - `Auth`, `network`, `chunk-load`, and `firestore` messages are calm and include support codes.
2. **Request diagnostics**
   - `web/src/lib/requestTelemetry.test.ts` passes.
   - Last request capture and curl rendering remain redacted for user-facing panels.
   - Auth failure reasons are captured when session/token errors occur.
3. **Retry + duplicate-submit guardrails**
   - `web/src/api/functionsClient.test.ts` passes, including:
     - dedupe for identical in-flight requests
     - stale-credential retry suppression
     - retry recovery after token refresh
4. **Storage resilience**
   - `web/src/lib/safeStorage.test.ts` passes (no throw on read/write/remove failures).
5. **Client runtime behavior**
   - Manual smoke walk:
     - trigger offline mode and confirm banner/retry path is visible.
     - trigger recoverable function error and confirm support code appears.
     - trigger chunk-load style runtime error and confirm reload guidance appears.
     - confirm blank-screen recovery path from `RootErrorBoundary`.
6. **End-to-end offline recovery smoke**
   - `portal-playwright-smoke` includes the `offline-to-online recovery` check.
   - Verify screenshots:
     - `portal-01b-offline-banner.png`
     - `portal-01c-online-recovered.png`

## Operator Notes

- Keep redaction on by default.
- If users report repeated retry loops, verify token/session headers and capture support code from banner before escalating.
- If a new Firestore index-related failure appears, point to `docs/runbooks/FIRESTORE_INDEX_TROUBLESHOOTING.md`.
