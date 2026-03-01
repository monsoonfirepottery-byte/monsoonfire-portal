# P1 — Library Frontend: Member Catalog and Discovery Experience

Status: In Progress
Date: 2026-03-01
Priority: P1
Owner: Frontend UX + Member Experience
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

The library experience needs a strong discovery surface for authenticated members and admins, without expanding unauthenticated attack surface.

## Objective

Ship a discovery-first catalog shell for member/admin users only, with no public browse mode.

## Scope

1. `LibraryPageShell` route-level orchestration for member/admin rendering.
2. Discovery rails for `staff picks`, `most borrowed`, `recently added`, and `recently reviewed`.
3. Shared item grid and item detail panel with role-specific interaction affordances.
4. Read API integration for catalog and item detail surfaces.
5. Auth-required route guard behavior with stable UX messaging.

## Role-Mode Behavior (Member/Admin)

1. Member mode shows discovery/detail surfaces with member interaction controls.
2. Admin mode shows the same browse/discovery surfaces and admin shortcuts while preserving catalog browsing behavior.
3. Unauthenticated users are redirected away from portal lending routes (no public read surface).

## Tasks

1. Implement mode-aware `LibraryPageShell` state that derives `member|admin` from auth/claims and passes mode to child components.
2. Build discovery data hooks for `GET /api/library/discovery` and render four rails with stable loading, empty, and error states.
3. Build paginated catalog hook for `GET /api/library/items` and bind to shared `LibraryCoverGrid` card model.
4. Add item detail fetch for `GET /api/library/items/:itemId` and render metadata, aggregate rating, tag list, and availability snapshot.
5. Remove `PublicPreviewPanel` behavior and route branches tied to public preview mode.
6. Add in-flight guards and deterministic request cancellation when search/sort/filter params change rapidly.
7. Add error-envelope mapping (`UNAUTHENTICATED`, `FORBIDDEN`, `FAILED_PRECONDITION`, `INTERNAL`) to user-facing banners/toasts.
8. Wire request tracing capture in dev tools so discovery and detail requests expose status, payload, and request id for debugging.

## Acceptance Criteria

1. Discovery rails render from `/api/library/discovery` and each rail tolerates partial/missing section payloads without breaking the page.
2. Catalog and detail data are sourced from `/api/library/items` and `/api/library/items/:itemId` with consistent card/detail field mapping.
3. Member/admin users can browse the same authenticated discovery surface with no duplicate route/component forks.
4. Error responses in the contract envelope render actionable messaging and preserve page interactivity.
5. Unauthenticated access to lending routes does not render a browse surface and does not white-screen.
6. QA verifies desktop and mobile rendering for member/admin mode paths.
