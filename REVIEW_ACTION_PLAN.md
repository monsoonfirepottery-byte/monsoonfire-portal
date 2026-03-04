> Status: Historical archive.
> Last reviewed: 2026-03-01.
> Canonical current references: `docs/README.md` and `docs/SOURCE_OF_TRUTH_INDEX.md`.

# Review Action Plan

## Status Update (2026-02-05)
- Completed from this plan:
  - P0-1 email extension region aligned to `nam5`.
  - P1-1 token listener moved to `onIdTokenChanged`.
  - P1-2 Firestore notification prefs key whitelists tightened.
  - P1-3 rate limiting now includes durable Firestore transaction bucket writes.
  - P1-4 dev admin token UI gated to emulator-only and session storage.
  - P1-5 app views code-split with `React.lazy` + `Suspense`.
  - P1-6 ARIA/focus updates on nav and chip controls.
  - P1-7 CORS allowlist reads from `ALLOWED_ORIGINS`.
  - P1-8 website CSP no longer requires inline script execution (`sha256` script hash in use).
  - P1-9 emulator + extension runbook added.
  - P2-1 legacy file archived to `functions/archive/index_old.ts`.
  - P2-2 website scripts deferred.
  - P2-3 materials page loading skeletons added.
  - P2-4 checkout error copy standardized in web + functions.
  - P2-5 website HTML audit run for missing `alt`; no missing `img alt` attributes found.
  - P2-6 Lighthouse CI budget workflow added.
  - P2-7 static asset cache headers added in `website/web.config`.
  - P2-8 explicit emulator-offline messaging added in Materials.
  - P2-9 staff claims setup doc added.
  - P2-10 checkout failure message hardened with retry guidance.
- Remaining: none in this document; keep this file as historical audit.

## Executive Summary
- Portal has a single-codebase App shell; high cohesion but no code-splitting, so initial bundle is likely large. Evidence: `web/src/App.tsx` renders all views directly.
- Email notifications are blocked by extension config region mismatch. Evidence: `extensions/firestore-send-email-5y3b.env` uses `DATABASE_REGION=us-central1` and function location `us-central1`.
- Auth state uses `onAuthStateChanged` only; staff claims won’t refresh until token refresh/sign-out. Evidence: `web/src/App.tsx`.
- Dev admin token is stored in sessionStorage; guardrails exist server-side but UI still exposes dev tooling. Evidence: `web/src/App.tsx`.
- Firestore rules are detailed for core collections but notification prefs are only lightly validated. Evidence: `firestore.rules`.
- Rate limiting is in-memory per function instance; no shared store. Evidence: `functions/src/shared.ts`.
- Website repo is static and CSP is present but still allows `unsafe-inline` scripts; consider tightening. Evidence: `website/web.config`.
- Accessibility is strong on website (skip link, alt text), but portal UI needs a pass on focus states and ARIA for collapsible nav + chips. Evidence: `web/src/App.tsx`, `web/src/App.css`, `web/src/views/ReservationsView.tsx`.
- Functions are HTTP-based with explicit auth; CORS allowlist is set but environment-driven. Evidence: `functions/src/shared.ts`.
- Emulator + extension config is fragile; missing a clear operational runbook. Evidence: `extensions/` and `docs/`.

## P0 (Ship-stoppers)
1) **Email extension region mismatch blocks deployment**
- Repo: portal
- Area: Backend
- Evidence: `extensions/firestore-send-email-5y3b.env` has `DATABASE_REGION=us-central1`; deployment error indicated Firestore is `nam5`.
- Recommendation: Reconfigure the extension to the actual Firestore region (`nam5`) and redeploy; remove stale env files after confirm.
- Effort: S
- Risk: Med
- What to test: Create a `/mail` doc and confirm delivery + status update.

## P1 (High value)
1) **Refresh staff claims on token change**
- Repo: portal
- Area: Security
- Evidence: `web/src/App.tsx` uses `onAuthStateChanged` only.
- Recommendation: use `onIdTokenChanged` (or listen to `idTokenChanges`) so role changes take effect without sign-out.
- Effort: S
- Risk: Low
- What to test: Toggle staff claim and verify UI updates after token refresh.

2) **Tighten notification prefs schema in rules**
- Repo: portal
- Area: Security
- Evidence: `firestore.rules` allows any `channels/events/frequency` map without key whitelist.
- Recommendation: add `hasOnlyKeys` checks for `channels/events/frequency/quietHours` to prevent unexpected fields.
- Effort: M
- Risk: Med
- What to test: Valid prefs update still works; unexpected fields rejected.

3) **Rate limiting is instance-local**
- Repo: portal
- Area: Backend
- Evidence: `functions/src/shared.ts` uses in-memory `Map` for rate limits.
- Recommendation: move rate limits to Firestore/Redis or a durable cache; or document that it’s best-effort.
- Effort: M
- Risk: Med
- What to test: rapid requests across instances are still throttled.

4) **Dev admin tools visible in production**
- Repo: portal
- Area: Security
- Evidence: `web/src/App.tsx` stores a session admin token and shows dev tooling based on emulator flags.
- Recommendation: hard-disable UI paths and storage in production builds (env guard + build-time strip).
- Effort: S
- Risk: Med
- What to test: prod build has no dev token UI; dev build still works.

5) **Portal lacks code-splitting for views**
- Repo: portal
- Area: Performance
- Evidence: `web/src/App.tsx` imports and renders all views directly.
- Recommendation: lazy-load views with `React.lazy` + `Suspense` to reduce initial JS cost.
- Effort: M
- Risk: Low
- What to test: initial load, route switches, error boundary fallback.

6) **A11y: missing ARIA + focus states on custom controls**
- Repo: portal
- Area: A11y
- Evidence: nav section toggles and chip-style controls appear in `web/src/App.tsx` and `web/src/views/ReservationsView.tsx` without explicit ARIA/focus styles.
- Recommendation: add `aria-expanded`, `aria-controls`, and visible focus states for toggles + chips.
- Effort: M
- Risk: Low
- What to test: keyboard-only navigation across nav and check-in estimator.

7) **CORS allowlist hard-coded defaults**
- Repo: portal
- Area: Backend
- Evidence: `functions/src/shared.ts` `DEFAULT_ALLOWED_ORIGINS` includes only localhost + monsoonfire.com.
- Recommendation: move allowlist to env for staging/portal domains; document required values.
- Effort: S
- Risk: Low
- What to test: requests from portal domain pass CORS preflight.

8) **Website inline scripts require `unsafe-inline`**
- Repo: website
- Area: Security
- Evidence: `website/index.html` includes inline GA/Metricool scripts; CSP in `website/web.config` allows `'unsafe-inline'`.
- Recommendation: move inline scripts to external files + use CSP nonce or hashes to remove `unsafe-inline`.
- Effort: M
- Risk: Low
- What to test: analytics still fire; CSP doesn’t block scripts.

9) **Operational runbook missing for emulator + extensions**
- Repo: portal
- Area: Docs
- Evidence: `docs/` lacks a single “start emulators + extensions” guide; `extensions/` present.
- Recommendation: add a short runbook with emulator env vars, extension config, and common errors.
- Effort: S
- Risk: Low
- What to test: new dev can start emulators without trial/error.

## P2 (Nice-to-have)
1) **Remove or archive legacy functions file**
- Repo: portal
- Area: Backend
- Evidence: `functions/src/index_old.ts` contains legacy endpoints.
- Recommendation: delete or move to `/archive` to avoid confusion.
- Effort: S
- Risk: Low
- What to test: functions build still passes.

2) **Website: consolidate static scripts + defer non-critical**
- Repo: website
- Area: Performance
- Evidence: `website/index.html` loads multiple scripts; `main.js` + `kiln-status.js`.
- Recommendation: defer non-critical scripts and combine where safe.
- Effort: S
- Risk: Low
- What to test: navbar + kiln status still work.

3) **Portal: add page-level skeletons for data loads**
- Repo: portal
- Area: UX
- Evidence: `web/src/views/MaterialsView.tsx` shows empty/error panels without loading skeletons.
- Recommendation: add lightweight skeletons to reduce perceived latency.
- Effort: S
- Risk: Low
- What to test: loading state appears and clears when data arrives.

4) **Portal: unify error toast language**
- Repo: portal
- Area: UX Writer
- Evidence: multiple views display raw error strings from functions client.
- Recommendation: standardize a short error copy + “Try again” actions.
- Effort: S
- Risk: Low
- What to test: error states are human-readable and consistent.

5) **Website: check for missing alt text on non-hero images**
- Repo: website
- Area: A11y
- Evidence: many image-heavy pages under `website/gallery` and `website/highlights` (not audited).
- Recommendation: run an HTML audit and add alt text where missing.
- Effort: M
- Risk: Low
- What to test: screen reader output on gallery pages.

6) **Portal: add Lighthouse perf + a11y budget**
- Repo: portal
- Area: Perf/A11y
- Evidence: no automated checks configured.
- Recommendation: add a simple CI script to run Lighthouse on key routes.
- Effort: M
- Risk: Low
- What to test: CI runs and reports metrics.

7) **Website: add cache headers for static assets**
- Repo: website
- Area: Performance
- Evidence: `website/web.config` lacks explicit cache headers for assets.
- Recommendation: add long cache headers for `/assets/`.
- Effort: S
- Risk: Low
- What to test: assets cache in browser devtools.

8) **Portal: add explicit offline messaging for emulator failures**
- Repo: portal
- Area: UX
- Evidence: Firebase errors surface in console; minimal user guidance.
- Recommendation: show a small banner when Auth/Firestore emulator is unreachable.
- Effort: S
- Risk: Low
- What to test: emulator down shows banner; banner clears when back.

9) **Portal: document admin/staff claims setup**
- Repo: portal
- Area: Docs
- Evidence: staff claim logic in `functions/src/shared.ts` and `firestore.rules` but no setup doc.
- Recommendation: add a short setup snippet to `docs/`.
- Effort: S
- Risk: Low
- What to test: new staff claim can be applied and recognized.

10) **Portal: verify checkout flows for Stripe errors**
- Repo: portal
- Area: Backend
- Evidence: `functions/src/materials.ts` and `functions/src/events.ts` create Stripe sessions.
- Recommendation: add clearer error messages + retry guidance on session failure.
- Effort: M
- Risk: Low
- What to test: forced Stripe failure surfaces friendly error.

## Quick Wins (1–2 hours)
- Fix extension region mismatch for email (P0-1).
- Add `onIdTokenChanged` listener for staff claims (P1-1).
- Add ARIA + focus styles for nav toggles and chips (P1-6).
- Document emulator + extension setup in `docs/` (P1-9).
- Add cache headers for website assets (P2-7).

## Deep Work (multi-day)
- Implement durable rate limiting for functions (P1-3).
- Code-split portal views (P1-5).
- CSP hardening to remove `unsafe-inline` (P1-8).
- Lighthouse budgets and CI checks (P2-6).

## Open Questions / Assumptions
- What is the canonical portal production domain for CORS allowlist?
- Is email delivery required in the emulator environment, or production only?
- Should staff claims be set via admin UI or CLI only?
- Do you want portal to support non-Google auth providers now or later?
- Should website analytics be reduced or moved to server-side?
- Is there a target bundle size for initial portal load?
- Should we enforce per-user rate limits with Firestore or a managed cache?
- Are there any legal requirements for notification opt-in language?
- Any pages on website that are being deprecated soon?
- Should the portal share design tokens with the website?
