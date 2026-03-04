# P2 — Library Frontend: Filtering, Search, and Mobile Polish

Status: In Progress
Date: 2026-03-01
Priority: P2
Owner: Frontend UX
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Discovery quality depends on fast, accurate search/filter behavior and polished small-screen interactions, but current behavior is not yet contract-complete across form factors.

## Objective

Implement contract-complete search/filter/sort controls with mobile-first usability improvements while keeping server-authoritative query behavior for web and iOS parity.

## Scope

1. Global search and deterministic sorting controls.
2. Full filter set from API contract.
3. URL-synced query state for deep linking and back/forward parity.
4. Mobile filter drawer and responsive item/detail ergonomics.
5. Accessibility and performance guardrails for interaction-heavy surfaces.

## Role-Mode Behavior (Member/Admin + Unauthenticated Guard)

1. Unauthenticated users are redirected/blocked from library routes and never render catalog filters.
2. Member mode uses standard search/filter behavior with enabled member interaction controls.
3. Admin mode uses the same search/filter behavior plus admin management entry points.

## Tasks

1. Implement `LibrarySearchBar` query binding to `q` parameter with debounced request dispatch and stale-request cancellation.
2. Implement `LibrarySortControl` for `highest_rated`, `most_borrowed`, `recently_added`, `recently_reviewed`, and `staff_picks`.
3. Implement `LibraryFilterPanel` fields for `mediaType`, `genre`, `studioCategory`, `availability`, `ratingMin`, and `ratingMax`.
4. Sync search/filter/sort/page state into URL params and restore state on route reload/back-forward navigation.
5. Ensure all filter/sort behavior is resolved server-side via `GET /api/library/items` and remove client-only filtering assumptions.
6. Build mobile filter drawer UX with sticky search/sort row, clear-all action, and apply button behavior.
7. Refine mobile detail sheet layout with sticky action area and compact metadata accordions.
8. Add keyboard/screen-reader semantics for filter controls and validate touch target spacing for mobile actions.

## Acceptance Criteria

1. Every filter and sort option in API contracts is available in the UI and round-trips through URL state.
2. Result ordering is deterministic and consistent with server-provided sort behavior.
3. Search/filter changes do not produce duplicate request races or stale-result flicker.
4. Mobile users can open/close/apply/clear filters with predictable state retention.
5. Desktop and mobile layouts preserve readable hierarchy for discovery rails, grid cards, and item detail.
6. Member/admin modes share one filtering/search implementation with role-specific action enablement only.
7. Accessibility checks pass for keyboard navigation, labels, and focus management on filter and detail controls.
8. No regressions to catalog load reliability when filters are combined at high-cardinality values.

## Execution Update (2026-03-01, Deep Pass)

Completed in this pass:
1. Implemented URL-synced search/filter/sort/item query state in `web/src/views/LendingLibraryView.tsx`:
   - read from URL on load,
   - restore on browser back/forward via `popstate`,
   - write state changes back to URL query params.
2. Preserved server-authoritative filtering/sorting with stale-request cancellation and debounced query dispatch.
3. Added mobile ergonomics refinements:
   - sticky mobile filter action area in filter drawer,
   - sticky detail action bar for reserve/waitlist/return + notify affordances.
4. Added visible active-filter summary and one-tap reset for faster browse recovery when query state gets dense.
