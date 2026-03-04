# P1 — Library Backend: Community Signals and Tag Moderation

Status: Completed
Date: 2026-03-01
Priority: P1
Owner: Platform Backend + Community Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Ratings, reviews, reading status, and tagging are not yet consistently moderated and normalized at the API layer, which weakens discovery quality and trust.

## Objective

Deliver production-grade community interaction endpoints with strict validation, moderation workflows, and canonical tag handling.

## Scope

1. Contract mapping (API): `docs/library/API_CONTRACTS.md` sections 4 and 5 for:
- `PUT /api/library/items/:itemId/rating`
- `POST /api/library/items/:itemId/reviews`
- `PATCH /api/library/reviews/:reviewId`
- `POST /api/library/items/:itemId/tags/submissions`
- `PUT /api/library/items/:itemId/reading-status`
- `POST /api/admin/library/tags/submissions/:submissionId/approve`
- `POST /api/admin/library/tags/:tagId/merge`
2. Contract mapping (schema): `docs/library/SCHEMA_RELATIONAL.md` sections 4, 6, and 7 using:
- `ratings`, `reviews`, `tags`, `item_tags`, `tag_submissions`, `user_reading_status`, `library_item_stats`
3. Validation and ownership rules for member-authored content edits.
4. Admin moderation and merge operations that preserve canonical taxonomy integrity.
5. Stats refresh so discovery and item detail views reflect updated community signals.

## Tasks

1. Implement rating upsert endpoint with 1..5 validation and one-rating-per-user-per-item enforcement.
2. Implement review create/edit endpoints with 1..1000 character validation, member ownership checks, and moderation-safe status handling.
3. Implement reading-status upsert endpoint with contract-allowed enum values only.
4. Implement tag-submission creation with normalization and duplicate detection against canonical tags.
5. Implement admin submission-approval flow that links or creates canonical tags and writes `item_tags` approval metadata.
6. Implement admin tag-merge flow that migrates item associations, updates submission references, and deactivates merged source tags.
7. Add post-write stats refresh path for rating/review aggregates used by catalog/discovery sorts.
8. Add contract and authorization tests for user ownership, admin-only moderation paths, and invalid payload handling.

## Acceptance Criteria

1. Community endpoints exactly match contract paths and allowed payload fields in `docs/library/API_CONTRACTS.md`.
2. Rating writes are idempotent per `(item_id, user_id)` and never create duplicates.
3. Review edits are limited to the review author (or admin moderation path) and enforce body-length bounds.
4. Tag submissions enter `pending` state and can be approved/merged through admin endpoints with canonical tag linkage.
5. Tag merge updates downstream associations so discovery/search uses the canonical tag only.
6. Reading-status writes enforce allowed enum values and upsert by `(user_id, item_id)`.
7. Aggregate item stats (rating/review counts and recency) update after community writes.

## Execution Update (2026-03-01)

Completed in this slice:
1. Implemented core community endpoints in `functions/src/apiV1.ts`:
   - `POST /v1/library.ratings.upsert`
   - `POST /v1/library.reviews.create`
   - `POST /v1/library.reviews.update`
   - `POST /v1/library.readingStatus.upsert`
2. Implemented recommendation + peer-feedback layer with moderation:
   - `POST /v1/library.recommendations.list`
   - `POST /v1/library.recommendations.create`
   - `POST /v1/library.recommendations.feedback.submit`
   - `POST /v1/library.recommendations.moderate`
   - `POST /v1/library.recommendations.feedback.moderate`
3. Implemented full tag moderation lifecycle:
   - `POST /v1/library.tags.submissions.create`
   - `POST /v1/library.tags.submissions.approve`
   - `POST /v1/library.tags.merge`
4. Added ownership/authz hardening:
   - non-staff recommendation queue leak prevention,
   - review owner-or-staff edit guard,
   - staff-only moderation and merge guards.
5. Added post-write community signal refresh so item aggregates stay current after rating/review writes (aggregate rating/count + review summary).
6. Added regression coverage in `functions/src/apiV1.test.ts` for tag routes, review edit authz, moderation authz, invalid actions, and highest-rated tie-break behavior.
