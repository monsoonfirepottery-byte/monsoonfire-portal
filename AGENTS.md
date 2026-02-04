# Monsoon Fire Portal — Agent Guide

This repo ships a React/Vite web portal as a reference implementation for an eventual iOS (Swift/SwiftUI) client. Keep patterns explicit, debuggable, and portable.

## Architecture (high level)

Always use Context7 MCP when you need library/API documentation, code generation, setup or configuration steps without me having to explicitly ask.

- web/ — React/Vite client
  - Firebase Auth (Google sign-in)
  - Firestore queries (active + history)
  - Calls Firebase Cloud Functions (HTTP endpoints)
  - Safety rails: ErrorBoundary, in-flight guards, troubleshooting capture, admin token persistence

- functions/ — Firebase Cloud Functions (HTTP)
  - Stateless request/response JSON contracts
  - Authorization: Bearer <idToken>
  - Dev-only admin token header: x-admin-token (user-pasted; never hardcode; stored in localStorage for convenience)

---

## Tooling quick commands

Web dev:
- cd web
- npm install
- npm run dev

Typecheck / lint (if configured):
- npm run typecheck
- npm run lint

Firebase emulators (from repo root or web — depends on your setup):
- firebase emulators:start --only firestore,functions

Deploy:
- firebase deploy --only functions
- firebase deploy --only firestore:rules

---

## Preflight (do this before big edits)

- Confirm Node version matches Vite requirement (or use nvm)
- Confirm firebase-tools version is installed and Java is compatible for emulators
- Confirm you can run web dev server
- Confirm emulators start cleanly (firestore + functions)

---

## Tooling conventions

- Package manager: npm (do not switch to pnpm/yarn without explicit request)
- Formatting: do not run repo-wide formatters unless requested
- Git: keep commits small; no mass renames

---

## Canonical docs and contracts

- API contracts: docs/API_CONTRACTS.md
- Firestore schema notes: docs/SCHEMA_*.md
- Mobile parity notes: docs/MOBILE_PARITY_TODOS.md (if present)

---

## Non-negotiables / do-not-regress / lessons learned

1) continueJourney requires uid + fromBatchId
- Request body MUST include: { uid: user.uid, fromBatchId }
- Must send Authorization: Bearer <idToken>

2) Firestore rejects undefined
- Never write undefined into Firestore payloads
- Omit the field or use null if allowed

3) Composite indexes
- Queries like (ownerUid == X) AND (isClosed == false) ORDER BY updatedAt desc may require a composite index
- If you see “failed-precondition: query requires an index”, create it via the console link

4) Safety rails are required
- Guard double-submit / repeated calls
- Use ErrorBoundary near top-level UI to prevent blank-screen failures
- Preserve troubleshooting info (payload, response, status, curl)

---

## How to change code (credit-smart delivery format)

Goal: spend credits on reasoning and precise edits, not on rewriting files.

### Default: patch-first edits (preferred)

- Prefer minimal diffs over full-file rewrites
- Only change the smallest possible surface area needed
- Keep edits surgical:
  - update 1–3 functions/components at a time
  - avoid reformatting unrelated code
  - do not “cleanup” unless explicitly requested

### When full-file replacement is appropriate

Use a full-file replacement only when:
- the file is small and the change is broad, or
- a refactor touches many scattered sections and a patch would be noisy or risky, or
- the file is already unstable and a clean baseline is safer

### Patch mechanics (Codex CLI friendly)

Use one of:
- unified diffs (git apply style)
- explicit find → replace with unique anchors
- in-place edits showing only the changed hunks

Avoid full rewrites unless the criteria above is met.

### Credit-saving workflow rules

- Read first, then edit: open target files before proposing changes
- Batch related changes in one pass, preferably within one file
- Pick one reasonable implementation; do not generate multiple alternatives
- Preserve working behavior; do not expand scope
- Do not refactor “for cleanliness,” “consistency,” or “future-proofing” unless explicitly requested
- Never hardcode secrets; x-admin-token is always user-provided input

---

## Codex Prompt Template (Credit-Optimized)

Use this structure when invoking Codex (CLI or UI).
It is designed to minimize token usage while maintaining correctness.

### Recommended prompt text

You can paste the following directly into Codex:

You are working in the Monsoon Fire Portal repo.

Constraints:
- Prefer minimal diffs over full-file rewrites
- Do NOT reformat unrelated code
- Do NOT rename variables or restructure unless required
- Read files before editing
- Limit changes to the smallest surface area needed
- Do not open more than 2 files unless necessary to understand the change

Process:
1) Open and read the relevant file(s)
2) State a brief plan (max 5 bullets)
3) Apply the minimal patch needed
4) Preserve all existing working behavior
5) If network or Firestore code is touched:
   - keep in-flight guards
   - keep troubleshooting capture
6) Summarize:
   - files changed
   - behavior changed
   - how to manually test

Output rules:
- Show only changed hunks or diffs
- Avoid full file replacement unless explicitly requested
- Do not generate multiple alternative solutions

### When to override this template

Only override if:
- a full-file replacement is explicitly requested, or
- a large refactor spans many files and patches would be unclear

---

## Stop conditions (ask / halt instead of thrashing)

Stop and report if:
- The change requires touching more than 2 existing files (new files are allowed only if explicitly requested)
- A Firestore index is required (provide the index hint and where it’s triggered)
- You hit auth/permission errors you can’t resolve from repo config
- You cannot find the referenced function/route/schema

---

## Troubleshooting capture format (when network calls change)

Record:
- endpoint + method
- request headers (redact tokens)
- request body (omit secrets)
- response status + body
- curl equivalent (with <TOKEN> placeholders)

---

## Debugging priority order

1) Missing composite Firestore index
2) Undefined value written to Firestore
3) Missing required request fields (uid / fromBatchId)
4) Missing auth or x-admin-token headers
5) Duplicate imports, duplicate state variables, or stale closures

---

## Definition of Done (required for every coding response)

1) Files changed or generated (exact filenames)
2) What behavior changed (1–3 bullets)
3) Manual test checklist (short, copyable)
4) Known follow-ups (indexes, deploy order, cache, mobile parity)

---

## Coordination / File Ownership (anti-collision)

- Claim a file before editing by adding your name/initials + timestamp
- Only one active editor per file
- Prefer new files under web/src/views or web/src/components
- Release claims when merged or done

### Ownership (edit this list)

- web/src/App.tsx: [Codex] claimed 2026-02-04 10:12 for profile sign-out icon
- web/src/App.css: [Codex] claimed 2026-02-04 11:24 for kiln offline styling
- web/src/views/MyPiecesView.tsx: [Codex] claimed 2026-02-04 00:34 for check-in gate + remove new ware/collection UI
- web/src/views/DashboardView.tsx: [Codex] claimed 2026-02-04 11:24 for kiln offline naming
- web/src/views/KilnRentalsView.tsx: [Codex] claimed 2026-02-03 17:49 for kiln rentals overview
- web/src/views/KilnRentalsView.css: [Codex] claimed 2026-02-03 17:49 for kiln rentals overview
- web/src/views/StudioResourcesView.tsx: [Codex] claimed 2026-02-04 10:10 for studio resources overview
- web/src/views/StudioResourcesView.css: [Codex] claimed 2026-02-04 10:10 for studio resources overview
- web/src/views/MessagesView.tsx: (unclaimed)
- web/src/views/EventsView.tsx: (unclaimed)
- web/src/views/MaterialsView.tsx: (unclaimed)
- web/src/views/BillingView.tsx: [Codex] claimed 2026-02-04 10:32 for store rename follow-up
- web/src/views/ReservationsView.tsx: (unclaimed)
- web/src/views/GlazeBoardView.tsx: [Codex] claimed 2026-02-04 14:33 for glaze board staff uploads + filters
- web/src/views/GlazeBoardView.css: [Codex] claimed 2026-02-04 14:33 for glaze board staff uploads + filters
- web/src/views/ReservationsView.tsx: [Codex] claimed 2026-02-04 12:05 for load estimate bar
- web/src/views/ReservationsView.css: [Codex] claimed 2026-02-04 12:05 for load estimate bar
- web/src/views/LendingLibraryView.tsx: [Codex] claimed 2026-02-03 01:14 for lending library feature
- web/src/views/LendingLibraryView.css: [Codex] claimed 2026-02-03 01:14 for lending library feature
- web/src/views/CommunityView.tsx: [Codex] claimed 2026-02-03 01:14 for community overview updates
- web/src/views/CommunityView.css: [Codex] claimed 2026-02-03 01:14 for community overview updates
- web/src/views/KilnLaunchView.tsx: [Codex] claimed 2026-02-04 00:14 for kiln queue visualization update
- web/src/views/KilnLaunchView.css: [Codex] claimed 2026-02-04 00:14 for kiln queue visualization update
- web/src/views/EventsView.css: [Codex] claimed 2026-02-04 10:00 for events style normalization
- web/src/views/MaterialsView.css: (unclaimed)
- web/src/views/ReservationsView.css: (unclaimed)
- web/src/views/SupportView.css: (unclaimed)
- web/src/views/BillingView.css: (unclaimed)
- web/src/views/ProfileView.css: (unclaimed)
- web/src/views/KilnScheduleView.css: (unclaimed)
- web/src/views/KilnScheduleView.tsx: [Codex] claimed 2026-02-03 01:14 for kiln schedule updates
- web/src/views/MembershipView.css: (unclaimed)
- web/src/views/SupportView.tsx: (unclaimed)
- web/src/firebase.ts: [Cdx] claimed 2026-01-26 13:39 for emulator auth wiring
- web/src/index.css: (unclaimed)
- web/src/theme/themes.ts: (unclaimed)
- web/src/data/kilnScheduleMock.ts: [Codex] claimed 2026-02-03 01:14 for kiln schedule updates
- web/src/views/KilnScheduleView.css: [Codex] claimed 2026-02-04 11:30 for offline status styling
- web/src/types/kiln.ts: [Codex] claimed 2026-02-04 11:30 for offline status type
- functions/src/createReservation.ts: [Codex] claimed 2026-02-04 00:14 for kiln queue load status
- functions/src/createReservation.ts: [Codex] claimed 2026-02-04 10:58 for ware check-in workflow
- web/src/api/portalContracts.ts: [Codex] claimed 2026-02-04 10:58 for ware check-in contract updates
- web/src/lib/pricing.ts: [Codex] claimed 2026-02-04 12:25 for check-in estimator pricing utilities
- web/src/lib/pricing.test.ts: [Codex] claimed 2026-02-04 12:25 for check-in estimator pricing tests
- web/src/lib/glazes/filters.ts: [Codex] claimed 2026-02-04 14:33 for glaze board filters
- web/src/lib/glazes/filters.test.ts: [Codex] claimed 2026-02-04 14:33 for glaze board filter tests
- web/src/views/ReservationsView.tsx: [Codex] claimed 2026-02-04 12:25 for check-in estimator upgrade
- web/src/views/ReservationsView.css: [Codex] claimed 2026-02-04 12:25 for check-in estimator styling
- web/src/views/KilnLaunchView.tsx: [Codex] claimed 2026-02-04 12:25 for estimator queue display updates
- web/src/views/MyPiecesView.tsx: [Codex] claimed 2026-02-04 12:25 for send-to-next-firing shortcut
- web/src/App.tsx: [Codex] claimed 2026-02-04 12:25 for check-in prefill routing
- web/vite.config.ts: [Codex] claimed 2026-02-04 12:25 for vitest config
- web/package.json: [Codex] claimed 2026-02-04 12:25 for vitest scripts and deps
- functions/src/createReservation.ts: [Codex] claimed 2026-02-04 12:25 for estimator payload support
- firestore.rules: [Codex] claimed 2026-02-04 12:25 for estimator rules update
- docs/API_CONTRACTS.md: [Codex] claimed 2026-02-04 10:58 for ware check-in contract updates
- storage.rules: [Codex] claimed 2026-02-04 10:58 for check-in photo uploads
- docs/API_CONTRACTS.md: (unclaimed)
- functions/scripts/seedEmulator.js: [Cdx] claimed 2026-01-26 14:04 for local emulator seed
- functions/scripts/updateKilnStatus.js: [Codex] claimed 2026-02-04 11:36 for kiln status follow-up
- firestore.rules: [Codex] claimed 2026-02-04 00:14 for reservation load status rules
- functions/src/materials.ts: [Codex] claimed 2026-02-04 11:12 for security hardening
- SECURITY.md: [Codex] claimed 2026-02-04 11:12 for security checklist updates

### Coordination log

- 2026-02-04 14:33 — [Codex] claimed `web/src/views/GlazeBoardView.tsx`, `web/src/views/GlazeBoardView.css`, `web/src/lib/glazes/filters.ts`, and `web/src/lib/glazes/filters.test.ts` for glaze board staff uploads + filters
- 2026-02-04 00:34 — [Codex] claimed `web/src/views/MyPiecesView.tsx`, `web/src/views/ReservationsView.tsx`, and `web/src/views/ReservationsView.css` for check-in gate + pieces UI cleanup
- 2026-02-04 10:00 — [Codex] claimed `web/src/views/EventsView.css` for events style normalization
- 2026-02-04 10:01 — [Codex] claimed `web/src/views/LendingLibraryView.css` for lending hero style normalization
- 2026-02-04 10:12 — [Codex] claimed `web/src/App.tsx` and `web/src/App.css` for profile sign-out icon
- 2026-02-04 11:12 — [Codex] claimed `functions/src/materials.ts` and `SECURITY.md` for security hardening
- 2026-02-04 11:20 — [Codex] claimed `web/src/views/DashboardView.tsx` for kiln status wiring
- 2026-02-04 11:24 — [Codex] claimed `web/src/views/DashboardView.tsx` and `web/src/App.css` for kiln offline naming
- 2026-02-04 11:30 — [Codex] claimed `web/src/types/kiln.ts` and `web/src/views/KilnScheduleView.css` for offline status support
- 2026-02-04 11:40 — [Codex] claimed `web/src/views/ReservationsView.tsx` and `web/src/views/ReservationsView.css` for kiln offline gating
- 2026-02-04 11:55 — [Codex] claimed `web/src/views/ReservationsView.tsx` and `web/src/views/ReservationsView.css` for load profile merge
- 2026-02-04 12:05 — [Codex] claimed `web/src/views/ReservationsView.tsx` and `web/src/views/ReservationsView.css` for load estimate bar
- 2026-02-04 11:36 — [Codex] claimed `functions/scripts/updateKilnStatus.js` for kiln status follow-up
- 2026-02-04 00:14 — [Codex] claimed `web/src/views/KilnLaunchView.tsx`, `web/src/views/KilnLaunchView.css`, `functions/src/createReservation.ts`, and `firestore.rules` for kiln queue visualization + load status
- 2026-02-03 17:49 — [Codex] claimed `web/src/views/KilnRentalsView.tsx`, `web/src/views/KilnRentalsView.css`, and `web/src/App.tsx` for kiln rentals overview
- 2026-02-03 17:49 — [Codex] claimed `web/src/views/DashboardView.tsx` and `web/src/App.css` for dashboard embers
- 2026-02-03 17:26 — [Codex] claimed `web/src/views/DashboardView.tsx` and `web/src/App.css` for dashboard emphasis
- 2026-02-03 17:26 — [Codex] claimed `web/src/App.tsx` and `web/src/App.css` for profile card spacing
- 2026-02-03 17:04 — [Codex] claimed `web/src/views/KilnLaunchView.tsx` for nav availability update
- 2026-02-03 16:55 — [Codex] claimed `web/src/App.tsx` and `web/src/App.css` for nav section collapse
- 2026-01-26 00:57 — [Cdx] released claims on web/src/App.tsx, web/src/App.css, web/src/views/MyPiecesView.tsx, web/src/views/DashboardView.tsx, web/src/views/MessagesView.tsx, web/src/views/EventsView.tsx, web/src/views/MaterialsView.tsx, web/src/views/BillingView.tsx, web/src/views/ReservationsView.tsx, web/src/firebase.ts, web/src/index.css
- 2026-02-03 15:45 — [Codex] claimed `web/src/views/EventsView.css`, `web/src/views/MaterialsView.css`, `web/src/views/ReservationsView.css`, `web/src/views/SupportView.css`, and `web/src/views/BillingView.css` for portal visual harmonization
- 2026-02-03 16:05 — [Codex] claimed `web/src/views/ProfileView.css`, `web/src/views/KilnScheduleView.css`, and `web/src/views/MembershipView.css` for portal visual harmonization
- 2026-02-03 16:20 — [Codex] released claims on `web/src/views/EventsView.css`, `web/src/views/MaterialsView.css`, `web/src/views/ReservationsView.css`, `web/src/views/SupportView.css`, `web/src/views/BillingView.css`, `web/src/views/ProfileView.css`, `web/src/views/KilnScheduleView.css`, and `web/src/views/MembershipView.css`
- 2026-02-03 16:40 — [Codex] claimed `web/src/views/KilnLaunchView.tsx` and `web/src/views/KilnLaunchView.css` for kiln launch page
- 2026-02-03 16:40 — [Codex] claimed `web/src/App.tsx` and `web/src/App.css` for kiln launch page integration
- 2026-02-03 17:10 — [Codex] released claims on `web/src/App.tsx`, `web/src/App.css`, `web/src/views/KilnLaunchView.tsx`, and `web/src/views/KilnLaunchView.css`
- 2026-02-03 17:35 — [Codex] claimed `web/src/App.tsx`, `web/src/App.css`, `web/src/views/KilnLaunchView.tsx`, and `web/src/views/KilnLaunchView.css` for kiln launch staff controls + kiln styling
- 2026-02-03 17:55 — [Codex] released claims on `web/src/App.tsx`, `web/src/App.css`, `web/src/views/KilnLaunchView.tsx`, and `web/src/views/KilnLaunchView.css`
- 2026-02-03 18:10 — [Codex] claimed `web/src/views/KilnLaunchView.tsx` and `web/src/views/KilnLaunchView.css` for kiln image integration
- 2026-02-03 18:35 — [Codex] claimed `web/src/App.tsx`, `web/src/views/DashboardView.tsx`, and `web/src/views/SupportView.tsx` for workshop rename
- 2026-02-03 18:55 — [Codex] claimed `web/src/App.tsx`, `web/src/App.css`, and `web/src/views/DashboardView.tsx` for nav restructure
- 2026-02-03 19:10 — [Codex] released claims on `web/src/App.tsx`, `web/src/App.css`, and `web/src/views/DashboardView.tsx`
- 2026-02-03 01:14 — [Codex] claimed `web/src/App.tsx` and `web/src/views/DashboardView.tsx` for dashboard hero actions
- 2026-02-03 01:14 — [Codex] claimed `web/src/views/KilnScheduleView.tsx` and `web/src/data/kilnScheduleMock.ts` for kiln schedule updates
- 2026-02-03 01:14 — [Codex] claimed `web/src/views/ReservationsView.tsx` for work submission renaming
- 2026-02-03 01:14 — [Codex] claimed `web/src/views/LendingLibraryView.tsx`, `web/src/views/LendingLibraryView.css`, `web/src/views/CommunityView.tsx`, and `web/src/views/CommunityView.css` for lending library + community overview
- 2026-02-03 01:14 — [Codex] updated `firestore.rules` for library collections (note: file previously claimed by [Cdx])
- 2026-01-25 22:20 — [Cdx] claimed `web/src/views/MyPiecesView.tsx` and `web/src/App.css` for batch card hierarchy
- 2026-01-25 22:30 — [Cdx] claimed `web/src/App.css` for timeline readability upgrade
- 2026-01-25 22:36 — [Cdx] claimed `web/src/firebase.ts` for emulator wiring (continueJourney visibility)
- 2026-01-25 22:42 — [Cdx] claimed `web/src/views/MyPiecesView.tsx` and `web/src/App.css` for troubleshooting panel polish
- 2026-01-25 22:49 — [Cdx] claimed `web/src/index.css` for theme token de-duplication
- 2026-01-25 23:02 — [Cdx] claimed `web/src/views/DashboardView.tsx` for action clarity pass
- 2026-01-25 23:09 — [Cdx] claimed `web/src/views/MessagesView.tsx`, `web/src/views/EventsView.tsx`, `web/src/views/MaterialsView.tsx`, `web/src/views/BillingView.tsx` for action clarity pass
- 2026-01-25 22:14 — [Cdx] claimed `functions/src/createReservation.ts` for CORS fix
- 2026-01-25 22:06 — [Cdx] claimed `web/src/views/ReservationsView.tsx` and `web/src/views/ReservationsView.css` for action clarity pass
- 2026-01-25 22:01 — [Cdx] claimed `web/src/App.tsx` and `web/src/theme/themes.ts` for theme token integration
- 2026-01-25 21:57 — [Cdx] claimed `web/src/App.css` for responsive sanity pass
- 2026-01-26 23:38 — [Cdx] claimed `web/src/views/MyPiecesView.tsx`, `web/src/App.css`, and `firebase.json` for wares split view + emulator auth config
- 2026-01-26 23:44 — [Cdx] claimed `functions/src/index.ts` and `web/src/views/MyPiecesView.tsx` for client collection creation
- 2026-01-26 23:53 — [Cdx] claimed TypeScript build fixes across `web/src/App.tsx`, `web/src/views/MessagesView.tsx`, `web/src/views/ReservationsView.tsx`, `web/src/theme/themes.ts`, and unused React import cleanup in related views/components
- 2026-01-27 00:13 — [Cdx] claimed `functions/src/index.ts` for createBatch CORS preflight fix
- 2026-01-27 00:18 — [Cdx] claimed `firestore.rules` and `functions/src/index.ts` for batch editors rule + createBatch editors field
- 2026-02-03 14:40 — [Codex] claimed `web/src/App.css`, `web/src/index.css`, and `web/src/theme/themes.ts` for portal visual harmonization
- 2026-02-03 15:30 — [Codex] released claims on `web/src/App.css`, `web/src/index.css`, and `web/src/theme/themes.ts`
- YYYY-MM-DD HH:MM — [agent] claimed [file] for [task]
