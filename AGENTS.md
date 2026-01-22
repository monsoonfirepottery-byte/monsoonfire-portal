# Monsoon Fire Portal — Agent Guide

This repo ships a **React/Vite web portal** as a reference implementation for an eventual **iOS (Swift/SwiftUI) client**. Keep patterns explicit, debuggable, and portable.

## Architecture (high level)
Always use Context7 MCP when I need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.

- `web/` — React/Vite client
  - Firebase Auth (Google sign-in)
  - Firestore queries (active + history)
  - Calls Firebase Cloud Functions (HTTP endpoints)
  - Safety rails: ErrorBoundary, in-flight guards, troubleshooting capture, admin token persistence

- `functions/` — Firebase Cloud Functions (HTTP)
  - Stateless request/response JSON contracts
  - Authorization: Bearer `<idToken>`
  - Dev-only admin token header: `x-admin-token` (user-pasted; never hardcode)

## Non-negotiables / do-not-regress

1) **continueJourney requires uid + fromBatchId**
- Request body MUST include: `{ uid: user.uid, fromBatchId }`
- Must send `Authorization: Bearer <idToken>`

2) **Firestore rejects undefined**
- Never write `undefined` into Firestore payloads.
- Omit the field or use `null` if allowed.

3) **Composite indexes**
- Queries like `(ownerUid == X) AND (isClosed == false) ORDER BY updatedAt desc` can require a composite index.
- If you see “failed-precondition: query requires an index”, create it via the console link.

4) **Safety rails are required**
- Guard double-submit / repeated calls.
- Use ErrorBoundary near top-level UI to prevent blank-screen failures.
- Preserve troubleshooting info (payload, response, status, curl).

## How to change code (delivery format)

- Default to **full-file replacements** when modifying code files.
- Keep changes minimal and localized, but tidy.
- Do not hardcode secrets; `x-admin-token` is always user-provided input.

## Debugging priority order

1) Missing composite Firestore index
2) Undefined value written to Firestore
3) Missing required request fields (uid/fromBatchId)
4) Missing auth or x-admin-token headers
5) Duplicate imports/state vars or stale closures

## Definition of Done (required for every coding response)

1) Files changed or generated (exact filenames)
2) What behavior changed (1–3 bullets)
3) Manual test checklist (short, copyable)
4) Known follow-ups (indexes, deploy order, cache, mobile parity)

## Coordination / File Ownership (anti-collision)

- Claim a file before editing by adding your name/initials + timestamp under Ownership or the coordination log.
- Only one active editor per file. If you need to touch a claimed file, ask first.
- Prefer new files under `web/src/views` or `web/src/components` instead of editing `web/src/App.tsx` and `web/src/App.css`.
- Release the claim when your changes are merged or done.

### Ownership (edit this list)
- `web/src/App.tsx`: (unclaimed)
- `web/src/App.css`: (unclaimed)
- `web/src/views/SupportView.tsx`: (unclaimed)
- `web/src/views/SupportView.css`: (unclaimed)
- `web/src/views/MessagesView.tsx`: (unclaimed)
- `web/src/views/DashboardView.tsx`: (unclaimed)
- `web/src/views/KilnScheduleView.tsx`: (unclaimed)
- `web/src/views/KilnScheduleView.css`: (unclaimed)
- `web/src/views/MyPiecesView.tsx`: (unclaimed)
- `web/src/views/PlaceholderView.tsx`: (unclaimed)
- `web/src/views/SignedOutView.tsx`: (unclaimed)
- `web/src/types/messaging.ts`: (unclaimed)
- `web/src/types/kiln.ts`: (unclaimed)
- `web/src/utils/format.ts`: (unclaimed)
- `web/src/data/kilnScheduleMock.ts`: (unclaimed)
- `web/src/views/ReservationsView.tsx`: (unclaimed)
- `web/src/views/ReservationsView.css`: (unclaimed)
- `web/src/views/ProfileView.tsx`: (unclaimed)
- `web/src/views/ProfileView.css`: (unclaimed)
- `functions/src/createReservation.ts`: (unclaimed)
- `functions/src/shared.ts`: (unclaimed)
- `docs/SCHEMA_RESERVATIONS.md`: (unclaimed)
- `docs/SCHEMA_PROFILE.md`: (unclaimed)

### Coordination log
- YYYY-MM-DD HH:MM — [agent] claimed [file] for [task].
- 2026-01-21 10:55 — [codex] claimed AGENTS.md; docs/MOBILE_PARITY_TODOS.md; functions/src/shared.ts; functions/src/index.ts; functions/src/createReservation.ts; web/src/api/portalContracts.ts; web/src/timelineEventTypes.ts; functions/src/timelineEventTypes.ts; ios/PortalContracts.swift; ios/PortalModels.swift; ios/PortalApiClient.swift; ios/PortalApiSmokeTest.swift; ios/README.md for mobile parity + auth + timeline normalization.
- 2026-01-21 11:20 — [codex] claimed android/README.md; android/PortalContracts.kt; android/PortalApiClient.kt; android/PortalModels.kt; android/PortalApiSmokeTest.kt; docs/MOBILE_PARITY_TODOS.md; docs/API_CONTRACTS.md for Android parity scaffolding.
- 2026-01-21 11:45 — [codex] claimed android/build.gradle.kts; android/settings.gradle.kts; android/gradle.properties; android/app/build.gradle.kts; android/app/src/main/AndroidManifest.xml; android/app/src/main/java/com/monsoonfire/portal/reference/*.kt; docs/API_CONTRACTS.md; android/README.md for Android compile scaffolding.
- 2026-01-21 11:55 — [codex] claimed .github/workflows/android-compile.yml for Android compile CI.
- 2026-01-21 12:10 — [codex] claimed docs/MOBILE_PARITY_TODOS.md; docs/API_CONTRACTS.md; docs/PLAN_TIMELINE_MIGRATION.md; functions/src/normalizeTimelineEventTypes.ts; functions/src/index.ts for mobile parity docs + timeline migration tooling.
- 2026-01-21 12:35 — [codex] claimed web/src/views/MembershipView.tsx; web/src/views/MembershipView.css; web/src/App.tsx for membership page implementation.
- 2026-01-21 13:30 — [codex] claimed web/src/views/MaterialsView.tsx; web/src/views/MaterialsView.css; web/src/App.tsx; web/src/api/portalContracts.ts; functions/src/materials.ts; functions/src/index.ts; functions/package.json; docs/API_CONTRACTS.md; docs/MOBILE_PARITY_TODOS.md; docs/SCHEMA_MATERIALS.md; docs/SCHEMA_ORDERS.md for materials + Stripe checkout.
- 2026-01-21 16:17 — [codex] claimed web/src/views/EventsView.tsx; web/src/views/EventsView.css; functions/src/events.ts; functions/src/index.ts; web/src/api/portalContracts.ts; web/src/api/portalApi.ts; ios/PortalContracts.swift; ios/PortalApiClient.swift; android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt; android/app/src/main/java/com/monsoonfire/portal/reference/PortalApiClient.kt; docs/API_CONTRACTS.md for events roster + web UI.
- 2026-01-22 00:02 — [codex] claimed firebase.json for emulator port fix.
- 2026-01-22 00:07 — [codex] claimed functions/scripts/seedEvents.js; docs/SCHEMA_EVENTS.md; docs/PLAN_EVENTS.md; docs/HANDOFF_EVENTS_2026-01-22.md for event seeding + handoff.
- 2026-01-22 00:12 — [codex] claimed functions/scripts/seedMaterials.js; docs/SCHEMA_MATERIALS.md; docs/HANDOFF_MATERIALS_2026-01-21.md for materials seeding.
- 2026-01-22 00:16 — [codex] claimed web/src/index.css; web/src/App.css; web/src/views/EventsView.css; web/src/views/MaterialsView.css; web/src/views/MembershipView.css; web/src/views/SupportView.css; web/src/views/ProfileView.css; web/src/views/ReservationsView.css; web/src/views/KilnScheduleView.css for UI pass.
- 2026-01-22 18:17 — [codex] released web/src/index.css; web/src/App.css; web/src/views/EventsView.css; web/src/views/MaterialsView.css; web/src/views/MembershipView.css; web/src/views/SupportView.css; web/src/views/ProfileView.css; web/src/views/ReservationsView.css; web/src/views/KilnScheduleView.css after UI pass.
- 2026-01-21 18:33 — [codex] claimed docs/PLAN_BILLING.md; docs/RELEASE_NOTES.md; docs/DESIGN_2026-01-20.md; docs/MOBILE_PARITY_TODOS.md; docs/MILESTONE_2026-01-19.md; docs/HANDOFF_EVENTS_2026-01-22.md; docs/HANDOFF_MATERIALS_2026-01-21.md; docs/API_CONTRACTS.md for billing plan + doc updates.
- 2026-01-21 18:37 — [codex] released docs/PLAN_BILLING.md; docs/RELEASE_NOTES.md; docs/DESIGN_2026-01-20.md; docs/MOBILE_PARITY_TODOS.md; docs/MILESTONE_2026-01-19.md; docs/HANDOFF_EVENTS_2026-01-22.md; docs/HANDOFF_MATERIALS_2026-01-21.md; docs/API_CONTRACTS.md after billing plan + doc updates.
- 2026-01-21 18:45 — [codex] claimed web/src/views/BillingView.tsx; web/src/views/BillingView.css; web/src/App.tsx; firestore.rules for Billing page implementation and Firestore access adjustments.
- 2026-01-21 18:55 — [codex] released web/src/views/BillingView.tsx; web/src/views/BillingView.css; web/src/App.tsx; firestore.rules after Billing page implementation.
- 2026-01-21 18:58 — [codex] claimed functions/scripts/seedBilling.js; docs/PLAN_BILLING.md for billing seed + doc updates.
- 2026-01-21 19:02 — [codex] released functions/scripts/seedBilling.js; docs/PLAN_BILLING.md after billing seed + doc updates.
- 2026-01-21 19:18 — [codex] claimed web/src/firebase.ts for Firestore transport stability (long polling).
- 2026-01-21 19:22 — [codex] released web/src/firebase.ts after Firestore long-polling toggle.
- 2026-01-21 14:31 — [codex] claimed web/src/views/SupportView.tsx; web/src/views/SupportView.css for FAQ content + usability refresh.
- 2026-01-21 14:39 — [codex] claimed firestore.rules; docs/SCHEMA_SUPPORT.md for Firestore FAQ + support request schema.
- 2026-01-21 15:10 — [codex] claimed docs/PLAN_EVENTS.md; docs/SCHEMA_EVENTS.md for Events planning + schema.
- 2026-01-21 15:18 — [codex] claimed functions/src/events.ts; functions/src/index.ts for Events Cloud Functions.
- 2026-01-21 15:45 — [codex] claimed web/src/api/portalContracts.ts; web/src/api/portalApi.ts; ios/PortalContracts.swift; ios/PortalApiClient.swift; android/app/src/main/java/com/monsoonfire/portal/reference/PortalContracts.kt; android/app/src/main/java/com/monsoonfire/portal/reference/PortalApiClient.kt for Events API contracts.

## Marketing materials scan (January 20, 2026)

Findings from `C:\Users\micah\Dropbox\Businesses\Monsoon Fire\MF Marketing`:

- Assets are primarily media: `.HEIC` (61), `.jpg` (59), `.PNG` (25), `.MOV` (17), `.url` (5), `.jpeg` (3), `.svg` (1).
- Brand kit (`00 BRAND SYSTEM\Logos`) includes `logo.svg`, `logo.png`, `logo.jpg`, `small-logo.jpg`, `monsoon_fire_red_smoke.png`, plus two other PNG variants.
- Print materials (`04 ADS & PROMO\Print Materials`) include `front.jpg`, `back.jpg`, `business card draft.png`, and three `.url` placeholders.
- Raw photos are organized as: Finished Work (52), In-Progress (40), Mascot (39), Kiln Shots (13), Equipment (6). Classes contains only a `.url` placeholder.
- B-roll exists in `01 RAW ASSETS\B-Roll (Process)` (7 MOV files).
- `02 SOCIAL CONTENT (DRAFTS)`, `03 STRATEGY & CALENDAR`, `05 REFERENCE` are currently empty.
- The web app currently only uses `/public/branding/logo.png` (matches the brand `logo.png`).

Recommendations for future site content (not yet integrated):

- Add a gallery of Finished Work and a process/behind-the-scenes section using In-Progress + B-roll.
- Add a studio/amenities section using Equipment + Kiln Shots.
- Consider the mascot assets for onboarding/empty-state personality.
- Use `monsoon_fire_red_smoke.png` as a large-scale hero/backdrop asset.
- Convert `.HEIC` to `.jpg`/`.webp` and `.MOV` to `.mp4` before adding to `web/public`.
- Treat `.url` files as placeholders; export real assets before use.

Note: Revisit this scan with a dedicated marketing agent to curate selections, copy, metadata, and media conversions.

## Support FAQ Feature TODOs (Option A: Firestore)

Date: January 20, 2026
Owner: (TBD)
Status: In progress

### Decisions
- Submission path: Firestore `supportRequests` collection.
- Confirm FAQ content scope and tone (studio policies, kiln schedule, pieces tracking, classes, billing, membership).
- Define response-time expectations and urgent escalation copy.

### UI/UX tasks
- Add Support view with:
  - Quick-answer FAQ list (search + categories + expandable answers).
  - “Still need help?” panel with a short question form.
  - Clear non-urgent guidance and response-time expectations.
- Add empty/loading states for FAQ search results.
- Keep UI logic thin and portable (iOS parity).

### Data/model tasks (Firestore)
- Define `supportRequests` schema (minimum fields: uid, displayName/email, subject, body, category, createdAt, status).
- Ensure no `undefined` is written (omit or use `null`).
- Add in-flight guard + success/error messaging.
- Optional: staff-side view or admin workflow.

### Content tasks
- Draft initial FAQ entries (10–12 items).
- Curate categories and keywords per FAQ.
- Add any links to studio policy pages once available.

### QA / verification
- Validate FAQ search/filtering.
- Submit a non-urgent question (verify created record).
- Confirm Support view is routed from nav and works on mobile.

### Follow-up
- Revisit FAQ content and assets with a dedicated marketing agent.

## Agent findings & next steps (January 21, 2026)
- Created `docs/PLAN_PROFILE.md` laying out the Profile & Settings view roadmap (account summary, journey stats, history timeline, settings controls, and supporting notes) along with resiliency best practices.
- Confirmed `ProfileView` already streams `profiles/{uid}` plus batch history; the new page can lean on those same sources while adding the extra preferences/notes sections.
- Noted that `createReservation` Cloud Function (see `docs/SCHEMA_RESERVATIONS.md`) is still an outstanding dependency for the Reservations view; keep the Firestore schema rules and docs synchronized.
- Logged the need for staff tooling (e.g., staff role to confirm kiln firings) and for marketing-sourced content / metadata so future agents have guidance.
- Documented the latest schema details in `docs/SCHEMA_PROFILE.md` (new notification toggles + personal notes) and `docs/SCHEMA_RESERVATIONS.md` (response contract, validation, security) so handoffs stay precise.

**Note:** Revisit this repo with a dedicated marketing agent to curate the scanned assets, finalize metadata, and translate the recommendations above into concrete copy/media selections.
