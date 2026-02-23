# Epic: P1 — Reliability Hardening: Failure-Mode First UX

Status: Completed
Date: 2026-02-23
Priority: P1
Owner: Platform + Security (review) + QA (sign-off)
Type: Epic

## Problem

Portal and website features handle healthy workflows well, but failure behavior still needs stronger consistency when systems fail mid-flight. We need predictable messaging, safe fallback actions, and reliable diagnostics without sacrificing security or making recovery error-prone for end users.

## Scope

1. Client-facing handling for known high-impact failures across auth, payments, Firestore, functions, and network/runtime.
2. Safer and calmer operator/operator-facing diagnostics for both portal requests and emergency debugging.
3. Deterministic hardening checks and evidence expected during release.
4. Incremental rollout using existing patterns, no broad architectural rewrites.

## Non-goals

1. No production behavior changes for successful paths unless required for safety defaults.
2. No auth bypasses, secret storage, or token exposure.
3. No dependency on non-deterministic external systems in CI gates.
4. No API contract breakage for iOS/other clients without explicit compatibility note.

## Failure Mode Catalog

### A) Authorization / Identity

1. expired/invalid ID token
2. missing `Authorization` header
3. insufficient permissions / Firestore rules deny
4. user disabled / auth revoked mid-session
5. clock skew causing token rejection

### B) Payments (Stripe or equivalent)

1. network failure during checkout/session creation
2. provider error (`5xx`)
3. payment rate limiting (`429`)
4. invalid price/product configuration
5. payment requires additional user action (`SCA`)
6. eventual consistency during webhook propagation
7. customer portal link generation failure

### C) Database (Firestore)

1. query requires missing composite index
2. permission denied
3. partial/missing documents or fields
4. offline/transient unavailability
5. contention / aborted writes
6. `undefined` field attempts

### D) Cloud Functions / HTTP

1. CORS or blocked origin
2. request contract mismatch (`400`, missing `uid` / `fromBatchId`)
3. auth failures (`401/403`)
4. transient server errors (`5xx`)
5. timeout
6. double submit and idempotency replay risks

### E) Network + Runtime

1. offline and reconnect flow
2. slow network / request timeout
3. partial page load / chunk load errors
4. localStorage/sessionStorage corruption
5. blank screen prevention via top-level ErrorBoundary

## Risk Register

1. Diagnostics can become noisy if we re-throw too often.  
   *Mitigation:* gate user-facing retry/alerts by operation state and error category.
2. Overly strict failure handling could block existing user actions.  
   *Mitigation:* safe defaults and explicit retry actions.
3. Additional error UI can regress accessibility.  
   *Mitigation:* keep semantic headings, buttons, and support text visible and keyboard reachable.
4. Misclassified auth errors can loop into retries.  
   *Mitigation:* auth failures surface re-login guidance; network retries are explicit and bounded.
5. Secret leakage in telemetry snapshots.  
   *Mitigation:* redaction in telemetry and no token emission in UI text.
6. Partial doc reads in Firestore can throw or hide UI.  
   *Mitigation:* defensive field reads and explicit index guidance in copy.

## Rollout Plan / Gates

1. **Phase 1 (now):** complete failure-mode handling slice in existing components/APIs.
2. **Phase 2 (next):** extend observability tests and website parity checks.
3. **Phase 3 (next):** lock behavior in release gates once deterministic checks stay green.
4. Add feature flags only where needed; default to safe behavior without runtime toggles.
5. Any change that affects user actions needs no-credential-safe request capture.

## Work Breakdown (20 actionable tasks)

### A) Shared client error model + UI (2 tasks)

1. [x] Keep single shared `AppError` model with `kind`, `userMessage`, `debugMessage`, `correlationId`, `retryable` mapping across portal surfaces. (Owner: Platform)
2. [x] Standardize reusable `ErrorBanner`/`ErrorPanel` usage for top-level and runtime surfaces with support-code-first messaging. (Owner: Platform)

### B) Request capture + diagnostics (4 tasks)

3. [x] Ensure every cloud-function request capture records endpoint, method, and correlation id with timestamp. (Owner: Platform)
4. [x] Add `responseSnippet` to function request snapshots for fast triage. (Owner: Platform)
5. [x] Add redaction for request bodies in all snapshots before publication to telemetry. (Owner: Security)
6. [x] Build lightweight operator view for request snapshots (`endpoint`, `payload`, `status`, `response snippet`, `curl`). (Owner: QA)

### C) Authentication and session failures (3 tasks)

7. [x] Map auth/session expiry to explicit re-login support path and non-retry copy. (Owner: Platform)
8. [x] Prevent unbounded retry attempts from stale credentials (session-guard path per action). (Owner: QA)
9. [x] Add telemetry field for auth-expiry reason and support code handoff. (Owner: Security)

### D) Firestore and functions failure handling (4 tasks)

10. [x] Detect index-required errors and route to runbook/help copy with support code. (Owner: Platform)
11. [x] Keep Firestore reads tolerant of partial/missing doc fields. (Owner: Platform)
12. [x] Map common functions contract errors to actionable user copy for missing fields (`uid`, `fromBatchId`, malformed payload). (Owner: Platform)
13. [x] Handle idempotency/duplicate submit cases with in-flight guards and disabled primary action states. (Owner: QA)

### E) Network + runtime recovery (4 tasks)

14. [x] Preserve and harden offline banner/retry experience. (Owner: Platform)
15. [x] Keep top-level `ErrorBoundary` recovery path with safe-reset option and message path. (Owner: QA)
16. [x] Add optional developer panel for request-level debug only in safe modes. (Owner: Platform)
17. [x] Add explicit localStorage/sessionStorage corruption fallback for critical settings. (Owner: QA)
18. [x] Add chunk-load/runtime recovery path for website and portal where possible. (Owner: Platform)
19. [x] Add one end-to-end smoke case covering fail-open/restore path for offline->online. (Owner: QA)
20. [x] Publish a reliability evidence checklist (manual + deterministic checks). (Owner: QA)

## Acceptance Criteria

1. A user-facing auth/session failure shows a re-login path and does not loop retries.
2. Missing index failures include explicit guidance and support code.
3. Firestore/read path handles partial documents without throwing.
4. Double-submit actions are disabled while request is in-flight.
5. Portal `RuntimeHardeningChrome` and request diagnostics remain visible in dev and safe in production.
6. Request capture includes endpoint, method, status, timestamp, request body (redacted), `responseSnippet`, and curl example.
7. New hardening checks can run deterministically in CI without flaky external dependencies.
8. At least one top-level boundary prevents blank-screen regressions and offers recovery.

## Dependencies

- `web/src/errors/appError.ts`
- `web/src/components/ErrorBanner.tsx`
- `web/src/components/ErrorPanel.tsx`
- `web/src/components/RootErrorBoundary.tsx`
- `web/src/components/RuntimeHardeningChrome.tsx`
- `web/src/api/functionsClient.ts`
- `web/src/api/portalApi.ts`
- `web/src/api/portalContracts.ts`
- `web/src/hooks/useBatches.ts`
- `tickets/P1-hardening-shared-app-error-model-and-ui-components.md`
- `tickets/P1-hardening-functions-contract-timeout-and-idempotency-ux.md`
- `docs/runbooks/AGENT_SURFACES.md`

## Definition of Done

1. Failure-mode categories above are implemented as implemented tasks with owners.
2. Calming user-facing copy + actionable recovery exists for auth, network, Firestore, and function failures.
3. Diagnostics surface includes request metadata, support code, and reproducible curl snapshots.
4. Deterministic hardening lane remains green for local CI checks.
5. Epic transitions to Completed only after manual and automatic checks are linked to evidence.

## Ship Evidence (2026-02-23)

1. `npm --prefix web run test:run` (pass, 133 tests)
2. `npm --prefix web run build` (pass)
3. `npm run hardening:check` (pass)
4. `node --check scripts/portal-playwright-smoke.mjs` (pass)
5. `node --check website/assets/js/main.js` and `node --check website/ncsitebuilder/assets/js/main.js` (pass)
