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
