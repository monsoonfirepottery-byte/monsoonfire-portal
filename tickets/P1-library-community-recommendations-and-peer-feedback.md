# P1 — Library Community Recommendations and Peer Feedback

Status: Completed
Date: 2026-03-01
Priority: P1
Owner: Member Experience + Frontend UX + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Members can review items they have read, but they cannot directly recommend books to the community in a structured way that supports discovery, discussion, and studio learning momentum.

## Objective

Enable members to recommend books/resources to the community and collect peer feedback, while preserving moderation controls, clear UX, and authenticated-only access.

## Scope

1. Member recommendation submission for existing library items.
2. Member recommendation proposal for books not yet in catalog (ISBN/title/author fallback).
3. Community recommendation feed and item-level recommendation highlights.
4. Peer feedback controls (helpful votes and short feedback comments).
5. Moderation workflow for recommendation and feedback content quality/safety.

## Role-Mode Behavior (Member/Admin + Unauthenticated Guard)

1. Unauthenticated users are redirected/blocked and cannot view or submit recommendation interactions.
2. Members can create recommendations, add rationale/review context, and leave feedback on other member recommendations.
3. Admins can moderate recommendations/feedback, hide abusive content, and escalate high-signal recommendations into staff picks or acquisition queues.

## Tasks

1. Define recommendation domain model:
`LibraryRecommendations`, `RecommendationFeedback`, and moderation status fields with audit timestamps.
2. Add member endpoint for recommendation creation:
`POST /api/library/recommendations`.
3. Add member endpoint for listing recommendations:
`GET /api/library/recommendations` with filters (`itemId`, `status`, `sort`).
4. Add member feedback endpoint:
`POST /api/library/recommendations/:recommendationId/feedback` for helpful vote + short comment.
5. Add admin moderation endpoints for recommendation/feedback approval, hide, and restore actions.
6. Build member recommendation composer in Lending detail and catalog surfaces with clear character limits and validation.
7. Build recommendation feed UI with cover-first cards, concise recommendation reason, reviewer attribution, and feedback affordances.
8. Integrate recommendation signals into discovery rails (`community recommended`) with fallback behavior when data is sparse.
9. Add telemetry + audit events for recommendation create/feedback/moderation actions.

## Acceptance Criteria

1. Members can submit a recommendation tied to an existing item and include a short review-style rationale.
2. Members can propose a new book recommendation even if the item is not yet in catalog, using ISBN when available.
3. Members can leave feedback on recommendations, and helpful counts update without page reload.
4. Recommendation feeds render on mobile/desktop without metadata clutter and preserve fast browse-to-action flow.
5. Admin moderation actions immediately affect visibility and are captured in audit logs.
6. Recommendation data can be reused for future staff-pick curation and acquisition prioritization.
7. Unauthenticated users cannot access recommendation or feedback writes.

## Execution Update (2026-03-01)

Completed in this slice:
1. Added member API routes in `functions/src/apiV1.ts`:
   - `POST /v1/library.recommendations.list`
   - `POST /v1/library.recommendations.create`
   - `POST /v1/library.recommendations.feedback.submit`
2. Added recommendation persistence model (`libraryRecommendations`) with moderation defaults (`pending_review`) and audit logging.
3. Added feedback persistence model (`libraryRecommendationFeedback`) with helpful-count rollup updates.
4. Added member recommendation composer and recommendation feed in `web/src/views/LendingLibraryView.tsx`.
5. Added peer feedback controls (`Helpful`, `Needs context`) and optimistic UI updates.
6. Added admin moderation routes in `functions/src/apiV1.ts`:
   - `POST /v1/library.recommendations.moderate`
   - `POST /v1/library.recommendations.feedback.moderate`
7. Closed recommendation visibility/authz gap:
   - non-staff users cannot access other users’ `pending_review`, `hidden`, or `rejected` recommendation queues even when passing explicit status filters.
8. Added staff moderation controls in `web/src/views/StaffView.tsx` with approve/hide/restore actions and status feedback.
9. Added member optional feedback-note input in `web/src/views/LendingLibraryView.tsx` to attach context comments to recommendation feedback submissions.
10. Added regression tests in `functions/src/apiV1.test.ts` covering moderation route authz, invalid actions, and status-filter leakage prevention.
