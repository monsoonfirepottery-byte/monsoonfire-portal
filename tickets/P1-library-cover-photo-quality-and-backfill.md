# P1 — Library: Cover Photo Quality and Backfill

Status: In Progress
Date: 2026-03-01
Priority: P1
Owner: Library Ops + Catalog Data + Frontend UX
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Library browsing quality degrades when items are missing covers or use poor substitutes (for example, first-page scans instead of true front-cover imagery).

## Objective

Ensure every library object has a valid, human-recognizable cover photo and enforce quality rules so new items do not regress.

## Scope

1. Backfill missing or low-quality cover images across all media objects.
2. Add ingestion-time cover validation and fallback ordering.
3. Add admin review workflow for unresolved/low-confidence cover candidates.
4. Surface cover quality status in admin tools.

## Cover Quality Standard

1. Cover must depict the front cover art/photo for the object.
2. First-page scans, inside-page photos, or text-only scans are rejected.
3. If no valid cover is available from providers, item is flagged for manual cover upload.

## Tasks

1. Define provider preference order for cover retrieval in ISBN/import flows.
2. Add backend quality checks and “needs_cover_review” flag on uncertain matches.
3. Build one-time backfill job to re-resolve covers for existing catalog objects.
4. Add admin queue for manual cover correction/upload and approval.
5. Update frontend to display a clear placeholder only when no approved cover exists.
6. Add audit logging for cover overwrite events.

## Acceptance Criteria

1. New imports do not publish with first-page/inside-page images as covers.
2. Existing catalog reaches full approved cover coverage or explicit review queue status.
3. Member-facing catalog shows approved covers or a controlled placeholder.
4. Admins can resolve all flagged cover issues without direct DB edits.

## Execution Update (2026-03-01)

Completed in this slice:
1. Added ingestion-time cover quality evaluation in `functions/src/library.ts`.
2. ISBN import now writes:
   - `coverQualityStatus`,
   - `needsCoverReview`,
   - `coverQualityReason`,
   - `coverQualityValidatedAt`.
3. Metadata refresh flow now re-evaluates cover quality and records review flags while refreshing stale metadata.
4. Added Staff -> Lending cover-review queue UI in `web/src/views/StaffView.tsx` with resolution actions:
   - approve current cover,
   - set replacement cover URL and approve.

Remaining:
1. Expand quality heuristics with richer confidence signals (provider-specific image semantics).
2. Add stricter media-type-specific validation for non-book objects.

## Execution Update (2026-03-01, Cover Hardening Addendum)

Completed in this pass:
1. Expanded cover-quality URL confidence checks in `functions/src/library.ts`:
   - placeholder/default/missing-image patterns,
   - inside-page/sample/preview/back-cover cues,
   - low-resolution parameter hints,
   - invalid URL/protocol detection.
2. Added media-aware approval guardrails so non-book items are not auto-approved when cover URLs originate from generic book-cover providers.
3. Preserved existing staff cover review workflow by keeping `coverQualityStatus`, `needsCoverReview`, and `coverQualityReason` compatibility intact.
4. Updated member catalog/discovery cover rendering in `web/src/views/LendingLibraryView.tsx` to use approved-cover gating with a controlled placeholder when cover quality is missing or pending review.

Remaining:
1. Add focused backend unit tests around `evaluateCoverQuality` once a stable unit-test harness exists for `functions/src/library.ts` without widening ownership scope.
