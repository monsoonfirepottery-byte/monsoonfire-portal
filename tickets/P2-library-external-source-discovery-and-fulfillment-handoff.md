# P2 — Library External Source Discovery and Fulfillment Handoff

Status: Completed
Date: 2026-03-01
Priority: P2
Owner: Member Experience + Platform Backend + Frontend UX
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Members can search the studio library and still come up empty for a specific title. When that happens, the current flow dead-ends instead of helping them quickly find legitimate external ways to access the resource.

## Objective

Add a respectful external-discovery fallback that activates when local results are weak/empty, runs provider lookups in the background, and guides members to easy next steps (public library, legal digital access, or purchase options).

## Scope

1. Triggered external discovery fallback for low-confidence local search results.
2. Background provider broker for external availability signals.
3. Member-facing handoff cards with clear “how to get this” next steps.
4. Provider etiquette layer (timeouts, retries, throttling, caching, and usage-policy compliance).
5. Analytics and moderation-safe audit trail for external query behavior.

## Role-Mode Behavior (Member/Admin + Unauthenticated Guard)

1. Unauthenticated users are redirected/blocked and do not execute external source queries.
2. Members can trigger external suggestions when local library results are empty or insufficient.
3. Admins can view diagnostics for provider outcomes and disable/override specific providers when needed.

## Product Behavior

1. Local-first search always runs first.
2. External lookup activates only when:
   1. local results are empty, or
   2. local results fall below a configurable relevance threshold.
3. External lookup runs on explicit search submit (not every keystroke).
4. UI presents a dedicated “Find Outside Monsoon Fire” panel with:
   1. title/author matched candidates,
   2. source label,
   3. direct handoff action,
   4. short legal/availability disclaimer.

## Tasks

1. Build `ExternalLookupBroker` service with provider adapters and normalized response contract.
2. Add API endpoint:
`POST /api/library/external-lookup`
with normalized query payload and result set.
3. Add provider adapters for approved public sources (phase-gated), with clear per-provider feature flags.
4. Implement request etiquette guardrails:
   1. per-provider timeout budgets,
   2. retry with exponential backoff for transient errors,
   3. rate-limit and pacing controls,
   4. response caching for repeated queries.
5. Respect provider policy notes (quotas, attribution, usage limits) and store link references in docs.
6. Add frontend fallback panel in catalog/search view with non-intrusive reveal when local discovery misses.
7. Add action-oriented handoff UX:
   1. “Check public library availability”
   2. “View legal digital source”
   3. “Request studio acquisition”
8. Add telemetry for:
   1. local-miss -> external-lookup conversion,
   2. provider success/error/timeout rates,
   3. handoff click-through.
9. Add admin diagnostics in Staff -> Lending for provider health and policy-safe throttling status.

## Acceptance Criteria

1. Members who get zero/weak local results see clear external-source options without leaving a dead-end state.
2. External lookup does not run on every keystroke and remains latency-safe for catalog UX.
3. Provider failures/timeouts degrade gracefully without breaking local search or white-screening the page.
4. External suggestions are shown with source attribution and clear user guidance.
5. Provider request behavior is policy-aware (timeouts, pacing, retries, and caching) and avoids abusive request patterns.
6. Staff can disable a provider quickly if policy/rate conditions change.
7. Users can submit an in-portal “add this to studio library” request from external suggestion cards.

## Execution Update (2026-03-01)

Completed in this slice:
1. Added `POST /v1/library.externalLookup` route in `functions/src/apiV1.ts`.
2. Implemented provider broker helper in `functions/src/library.ts` with:
   - OpenLibrary + Google Books adapters,
   - timeout/retry/backoff/pacing policies,
   - in-memory TTL caching and in-flight dedupe,
   - provider diagnostics envelope (`ok`, `itemCount`, `cached`).
3. Added member-facing fallback panel in `web/src/views/LendingLibraryView.tsx` that:
   - appears for weak/empty local results,
   - uses explicit trigger (no per-keystroke provider traffic),
   - renders source-attributed external results,
   - supports public-library handoff and acquisition prefill.
4. Added Staff -> Lending provider probe diagnostics module for real-time provider health checks.
5. Added staff provider hard-disable controls:
   - `POST /v1/library.externalLookup.providerConfig.get`
   - `POST /v1/library.externalLookup.providerConfig.set`
   - policy-aware provider toggles in `web/src/views/StaffView.tsx` (Open Library / Google Books enable-disable).
6. Updated external broker behavior in `functions/src/library.ts`:
   - provider policy cache + persisted config read/write,
   - policy-aware provider suppression (no upstream calls when paused),
   - response diagnostics now include `policyLimited` and per-provider `disabled` state.
7. Added provider policy regression tests in `functions/src/apiV1.test.ts` for staff access and non-staff denial.
