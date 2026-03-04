# P1 — Library Frontend: Member Interactions and Reading State

Status: Completed
Date: 2026-03-01
Priority: P1
Owner: Frontend UX + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Member actions are defined in API contracts but need a cohesive, guardrailed frontend interaction layer for lending, feedback, and reading-state tracking.

## Objective

Implement a single `MemberInteractionPanel` workflow that supports borrow/check-in, rating/review, tag submission, and reading status with explicit error handling and role gating.

## Scope

1. Physical borrow and check-in actions with lifecycle-safe UI states.
2. Ratings, reviews, tag submissions, and reading-status controls.
3. Member borrow timeline and history view.
4. Contract-accurate validation and response handling.
5. Shared role-aware interaction controls in item detail and member profile context.

## Role-Mode Behavior (Member/Admin + Unauthenticated Guard)

1. Unauthenticated users are redirected/blocked from interaction routes and never render write controls.
2. Member mode enables self-service actions on eligible items and enforces per-endpoint validation feedback.
3. Admin mode can access member interaction controls for testing/moderation context but should prefer dedicated admin actions for overrides.

## Tasks

1. Add borrow action handler for `POST /api/library/items/:itemId/borrow` with donation input, in-flight guard, and success-state due-date rendering.
2. Add check-in action handler for `POST /api/library/borrows/:borrowId/check-in` and optimistic lifecycle update with server reconciliation.
3. Add rating upsert flow for `PUT /api/library/items/:itemId/rating` with 1-5 star input validation and overwrite behavior.
4. Add review create/edit flows for `POST /api/library/items/:itemId/reviews` and `PATCH /api/library/reviews/:reviewId` with 1-1000 character guardrails.
5. Add moderated tag submission flow for `POST /api/library/items/:itemId/tags/submissions` with confirmation messaging.
6. Add reading-status control for `PUT /api/library/items/:itemId/reading-status` supporting `have`, `borrowed`, `want_to_read`, and `recommended`.
7. Add member borrow timeline query for `GET /api/library/me/borrows` and render active/history states in one timeline surface.
8. Map contract error codes (`CONFLICT`, `FORBIDDEN`, `INVALID_ARGUMENT`, `FAILED_PRECONDITION`) to field-level and action-level feedback.

## Acceptance Criteria

1. Member borrow action only succeeds for lending-eligible physical items and reflects updated availability immediately after server confirmation.
2. Check-in updates active borrow state and returns item to available state in UI without manual refresh.
3. Member can submit one rating per item and update that rating without creating duplicates.
4. Review editor enforces contract length limits and preserves prior content on failed requests.
5. Tag submission confirms moderation workflow and does not expose unapproved tags as canonical until approved.
6. Reading-status selector persists and rehydrates correctly on revisit and cross-device login.
7. `/api/library/me/borrows` renders active and historical entries in a single consistent timeline layout.
8. Unauthenticated users cannot trigger member writes, and admin/member users receive contract-accurate error handling for invalid transitions.

## Execution Update (2026-03-01)

Completed in this slice:
1. Added borrow/check-in handlers in `web/src/views/LendingLibraryView.tsx` with in-flight guards and lifecycle-safe status messaging.
2. Added rating/review/read-status interaction flows and persistence hydration.
3. Added recommendation interaction layer (create + feedback) with optimistic updates and contract-safe fallback paths.
4. Added optional feedback-note input for recommendation feedback to improve peer context and moderation quality.
5. Added review update wiring in `web/src/views/LendingLibraryView.tsx`:
   - auto-detects member’s existing review per item,
   - submits via `POST /v1/library.reviews.update`,
   - falls back to Firestore merge update when API path is unavailable.
6. Added moderated tag-submission flow in `web/src/views/LendingLibraryView.tsx`:
   - member tag draft + submit UI in item detail,
   - `POST /v1/library.tags.submissions.create` wiring,
   - fallback Firestore write path when API route is unavailable,
   - clear moderation-state confirmation messaging.
