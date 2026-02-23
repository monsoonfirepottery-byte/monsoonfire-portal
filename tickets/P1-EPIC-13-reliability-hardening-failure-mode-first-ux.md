# Epic: P1 — Reliability Hardening: Failure-Mode First UX

Status: Completed
Completed: 2026-02-23
Date: 2026-02-22
Priority: P1
Owner: Platform + Security (review) + QA (sign-off)
Type: Epic

## Problem

Portal and website behaviors are strong in healthy-path workflows, but real failure states (auth, payments, database, functions, network/runtime) can still produce confusing or brittle UX.

We need predictable, calm, and safe client-facing behavior when critical dependencies fail, while preserving current behavior when systems are healthy.

## Objective

Ship an incremental reliability hardening program that:

1. Enumerates and tracks critical failure modes as first-class product requirements.
2. Adds user-facing error handling with clear retry/recovery paths.
3. Improves operator debuggability with structured, safe request diagnostics.
4. Preserves security posture and existing healthy-path behavior.

## Tickets

- `tickets/P1-hardening-shared-app-error-model-and-ui-components.md`
- `tickets/P1-hardening-cloud-request-capture-and-operator-panel.md`
- `tickets/P1-hardening-auth-session-expiry-and-role-denial-ux.md`
- `tickets/P1-hardening-payments-failure-and-eventual-consistency-ux.md`
- `tickets/P1-hardening-firestore-index-permission-and-partial-data-guards.md`
- `tickets/P1-hardening-functions-contract-timeout-and-idempotency-ux.md`
- `tickets/P1-hardening-network-offline-timeout-and-retry-surface.md`
- `tickets/P1-hardening-runtime-error-boundary-and-safe-reset.md`
- `tickets/P2-hardening-localstorage-corruption-and-safe-defaults.md`
- `tickets/P2-hardening-website-runtime-error-and-offline-banners.md`
- `tickets/P2-hardening-ci-deterministic-failure-mode-regression-lane.md`
- `tickets/P2-hardening-runbook-telemetry-and-release-evidence.md`

## Scope

1. Client-facing reliability UX for portal and website surfaces.
2. Structured error modeling and request diagnostics for Cloud Functions clients.
3. Defensive handling for known operational failure classes.
4. Deterministic checks and runbook evidence for release confidence.

## Non-goals

1. No auth bypasses, security relaxations, or secret exposure.
2. No live external dependency checks in required CI gates.
3. No broad architecture rewrite; this is incremental hardening.
4. No schema-breaking API contract changes for mobile parity.

## Failure Mode Catalog

### A) Authorization / Identity

1. Expired/invalid ID token.
2. Missing `Authorization` header.
3. Insufficient permissions / Firestore rules deny.
4. User disabled / auth revoked mid-session.
5. Clock skew causing token rejection.

### B) Payments (Stripe or equivalent)

1. Network failure during checkout/session creation.
2. Provider error (`5xx`) and rate-limit (`429`).
3. Invalid price/product ID or configuration mismatch.
4. Payment requires action (SCA) / incomplete payment.
5. Webhook not yet processed (eventual consistency).
6. Customer portal link generation fails.

### C) Database (Firestore)

1. Query requires missing composite index.
2. Permission denied.
3. Missing/partial fields (defensive typing).
4. Offline or transient unavailability.
5. Contention/aborted writes.
6. `undefined` field writes (must never occur).

### D) Cloud Functions / HTTP endpoints

1. CORS/blocked origin.
2. `400` contract mismatch (e.g., missing `uid`/`fromBatchId`).
3. `401`/`403` auth failures.
4. `500` transient errors.
5. Request timeouts.
6. Double-submit/idempotency gaps.

### E) Network & Runtime

1. Offline mode.
2. Slow network/timeouts.
3. Partial page load/chunk errors.
4. `localStorage` corruption (admin token/prefs).
5. Blank-screen prevention via ErrorBoundary and safe defaults.

## Risk Register

1. Overly-generic messages can hide actionable failure roots.
   - Mitigation: include correlation/request codes and structured debug context.
2. Diagnostics may accidentally expose sensitive payload fields.
   - Mitigation: redact known sensitive keys by default and keep advanced panel opt-in.
3. Retry behavior can trigger duplicate side effects.
   - Mitigation: in-flight guards, disabled actions, idempotency-aware UX copy.
4. Additional UI states can regress existing healthy flows.
   - Mitigation: deterministic tests and incremental rollout flags.

## Rollout Plan

### Phase 1 (now)

1. Shared AppError model and reusable ErrorBanner/ErrorPanel.
2. Last-request capture in Cloud Function wrappers.
3. Common failure handling: auth/session, missing index, offline, double-submit UX.
4. Hardened top-level ErrorBoundary recovery controls.

### Phase 2

1. Payment eventual-consistency messaging and retry state models.
2. Expanded Firestore contention/transient handling.
3. Website runtime/offline error surfacing parity hardening.

### Phase 3

1. Deterministic CI regression lane for hardening checks.
2. Runbook evidence requirements and release sign-off gates.

### Feature Flags / Progressive Controls

1. Advanced diagnostics panel is opt-in (`Advanced` toggle) and dev-visible by default.
2. Optional deep diagnostics checks are non-blocking until stabilized.

## Work Breakdown (Grouped)

### Shared Error Model + UI

1. Define typed AppError with kind/message/debug/retry/correlation fields.
2. Add error classification helper for auth/payment/firestore/functions/network/unknown.
3. Add reusable ErrorBanner component.
4. Add reusable ErrorPanel component with copyable support code/details.

### Cloud Function Request Diagnostics

5. Record last request metadata (endpoint/method/redacted payload/status/snippet/timestamp/curl).
6. Add global telemetry channel for operator panels.
7. Surface diagnostics in portal Advanced panel.

### Authorization UX

8. Normalize auth failure messaging to "session expired / sign in again" flow.
9. Prevent silent/infinite retry loops on auth failures.
10. Include correlation IDs in auth-facing error states.

### Payments UX

11. Differentiate transient payment errors vs configuration mismatch.
12. Add eventual-consistency copy for webhook-in-flight states.
13. Add retry-safe payment action states and disable duplicate submissions.

### Firestore UX

14. Detect missing-index errors and show actionable message/runbook pointer.
15. Normalize permission-denied and partial-data fallback behavior.
16. Guard against undefined writes and malformed state assumptions.

### Functions/Network UX

17. Map 400/401/403/429/5xx/timeout failures to stable user messages.
18. Add offline banner and reconnect guidance.
19. Ensure loading/retry controls are explicit and non-destructive.

### Runtime / Website / Operations

20. Strengthen top-level ErrorBoundary recovery paths.
21. Add website runtime error/offline banners where scripts are active.
22. Add deterministic CI hardening checks.
23. Publish runbook + evidence matrix for QA and release.

## Acceptance Criteria

1. Portal and website render calm actionable error UI for offline/runtime failures.
2. Cloud Function wrappers record last-request diagnostics with redacted payloads.
3. Auth failure UX prompts re-login and avoids retry loops.
4. Missing Firestore index failures display actionable "index required" guidance.
5. In-flight guards prevent double-submit on critical actions.
6. Top-level ErrorBoundary recovery path exists (reload + safe reset).
7. New checks remain deterministic (no flaky external dependencies).
8. Epic and tickets are discoverable via `node ./scripts/epic-hub.mjs list`.

## Dependencies

- `scripts/epic-hub.mjs`
- `web/src/App.tsx`
- `web/src/api/functionsClient.ts`
- `web/src/api/portalApi.ts`
- `web/src/hooks/useBatches.ts`
- `website/assets/js/main.js`
- `website/ncsitebuilder/assets/js/main.js`
- `docs/runbooks/PR_GATE.md`

## Definition of Done

1. Failure-mode catalog is implemented as concrete tickets with owners.
2. Slice 1 hardening is merged and verified in deterministic local checks.
3. User-facing error states include "Try again" guidance and support code.
4. Diagnostics are redacted-by-default and security-reviewed.
5. Healthy-path behavior remains unchanged in smoke checks.
