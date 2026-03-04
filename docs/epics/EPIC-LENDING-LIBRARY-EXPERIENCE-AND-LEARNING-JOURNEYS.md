# EPIC: LENDING-LIBRARY-EXPERIENCE-AND-LEARNING-JOURNEYS

Status: In Progress (Reopened)
Date: 2026-03-01
Priority: P1
Owner: Library Ops + Program Ops + Member Experience
Type: Epic
Epic Ticket: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

The Lending Library currently works as a basic catalog/request surface but feels flat and low-context for members. It lacks curation, guided discovery, and connective tissue between learning content and hands-on studio programming.

## Objective

Transform Lending Library into a learning pathway surface that increases member value, drives workshop participation, and captures demand for new workshop topics, with functionality-first browsing and reduced UI noise.

## Scope

1. Reactive discovery and recommendation surfaces.
2. Staff-driven curation and editorial content.
3. Technique learning pathways connected to workshops.
4. Member feedback loops (reviews, outcomes, requests).
5. Lending lifecycle UX upgrades (availability, holds, reminders, renewals).
6. Design/interaction pass to make the experience feel alive and intentional.
7. Functional browse-and-select UX path that prioritizes decision clarity over metadata chiplet density.
8. Cover-photo quality enforcement so all library objects use true cover imagery (not first-page scans).
9. Authenticated-only access model (member/admin); no public read surface.

## Product Direction

1. Recommended next read with staff rationale and member context.
2. Technique retrospectives that resurface older high-value books.
3. Newly published works recommended by staff.
4. Two-way technique/workshop pathway:
   1. From workshops to techniques: members can see techniques taught and related books.
   2. From techniques/books to workshops: members can request workshops for techniques they want to practice.
5. UX reference direction (for browsing/selection ergonomics):
   1. Goodreads-style cover-first discovery and list scanning behavior.
   2. Amazon-style product detail hierarchy with clear primary decision fields.
   3. Apply these as interaction references only; keep Monsoon Fire visual identity and reduced clutter.

## Tasks

1. Define IA and data contracts for recommendation rails, curation shelves, and learning-path metadata.
2. Implement the two-way Technique <-> Workshop pathway and workshop request capture.
3. Add member-facing engagement loops (reviews, outcomes, and interest signals).
4. Improve lending operational UX (queue state, ETA, reminder, and renewal affordances).
5. Execute a frontend visual/interaction pass for richer, reactive UI behavior.
6. Execute a functional UX redesign to reduce chiplet overload and improve browse/select completion speed.
7. Enforce and backfill cover image quality across all library objects.

## Acceptance Criteria

1. Lending homepage includes dynamic recommendation and curation sections.
2. Each workshop can display related techniques and books.
3. Each technique/book can link to existing workshops or submit a workshop request.
4. Staff receives structured demand signals for requested technique workshops.
5. Members can quickly understand availability, queue state, and next action.
6. UX quality is measurably improved (lower drop-off, higher click-through to requests/workshops).
7. Catalog cards and detail views avoid chiplet overload; primary decision fields remain immediately scannable.
8. Library objects display true cover imagery (photo/illustration of cover), not first-page scans.

## Child Tickets

- tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md
- tickets/P1-lending-library-reactive-discovery-and-staff-curation.md
- tickets/P1-lending-library-local-isbn-reference-catalog-and-remote-fallback.md
- tickets/P1-lending-library-technique-to-workshop-pathway.md
- tickets/P1-lending-library-member-learning-signals-and-reviews.md
- tickets/P1-lending-library-lifecycle-ux-and-operational-feedback.md
- tickets/P2-lending-library-frontend-design-and-motion-pass.md
- tickets/P1-lending-library-hybrid-system-documentation-and-contracts.md
- tickets/P1-library-backend-catalog-and-discovery-api-v1.md
- tickets/P1-library-backend-lending-lifecycle-and-overdue-ops.md
- tickets/P1-library-backend-community-signals-and-tag-moderation.md
- tickets/P1-library-backend-isbn-ingestion-and-deduplication.md
- tickets/P2-library-backend-observability-audit-and-safeguards.md
- tickets/P1-library-frontend-member-catalog-and-discovery-experience.md
- tickets/P1-library-frontend-member-interactions-and-reading-state.md
- tickets/P1-library-frontend-admin-library-management-and-isbn-flow.md
- tickets/P1-library-frontend-functional-browse-and-selection-ux-path.md
- tickets/P1-library-community-recommendations-and-peer-feedback.md
- tickets/P1-library-cover-photo-quality-and-backfill.md
- tickets/P2-library-frontend-filtering-search-and-mobile-polish.md
- tickets/P2-library-external-source-discovery-and-fulfillment-handoff.md
- tickets/P2-library-release-plan-phased-rollout-and-cutover.md

## Historical Snapshot (2026-02-28, Superseded)

1. Earlier execution notes recorded a near-complete snapshot, but this epic is actively reopened and remains `In Progress`.
2. Use current execution sections and child-ticket status as source of truth for completion state.

## Documentation Track (2026-03-01)

1. Added a dedicated library docs pack in `docs/library/` for the next-stage hybrid lending + knowledge architecture.
2. Added architecture and UX system design in `docs/library/ARCHITECTURE.md`.
3. Added relational schema design in `docs/library/SCHEMA_RELATIONAL.md`.
4. Added API contract draft in `docs/library/API_CONTRACTS.md`.
5. Added tracking ticket `tickets/P1-lending-library-hybrid-system-documentation-and-contracts.md`.
6. Implemented initial `apiV1` library routes and frontend API-first catalog loading with Firestore fallback.

## Reopen Track (2026-03-01)

1. Epic reopened to add a functionality-first UI/UX path and cover photo quality guarantees.
2. Added explicit UX reference direction from Goodreads/Amazon browsing and selection patterns.
3. Added child ticket `tickets/P1-library-frontend-functional-browse-and-selection-ux-path.md`.
4. Added child ticket `tickets/P1-library-cover-photo-quality-and-backfill.md`.

## Internal UX A/B Decision (2026-03-01)

1. Variant A (metadata-forward): dense card metadata chiplets, always-visible full filter matrix, staff ISBN tools inside member Lending page.
2. Variant B (functionality-first): cover-first cards, progressive metadata disclosure, quiet/collapsible filters, and staff ISBN tools consolidated under Staff -> Lending.
3. Internal decision criteria:
   1. Faster browse-to-action path.
   2. Lower scan fatigue on mobile.
   3. Fewer operator errors for ISBN intake.
4. Internal score snapshot (1-5):
   1. Time to confident selection: A=3, B=5.
   2. Mobile scan legibility: A=2, B=5.
   3. Metadata depth recoverability: A=4, B=4.
   4. Staff ISBN error resistance: A=2, B=5.
5. Selected direction: Variant B.
6. Rationale: Variant B preserves power-user depth but reduces cognitive load and operational mis-click risk.

## Execution Update (2026-03-01)

1. Public read surface direction is removed from active epic execution; library remains authenticated-only.
2. Staff ISBN bulk import + scanner check-in controls are now consolidated in the Staff Lending module and removed from member-facing Lending view.
3. External source fallback shipped end-to-end:
   1. `apiV1` external lookup route with provider safeguards and diagnostics.
   2. Member fallback panel with explicit trigger, public-library handoff, and acquisition prefill.
   3. Staff-side provider probe diagnostics in Lending operations.
4. Community recommendation + peer feedback baseline shipped:
   1. list/create/feedback routes in `apiV1`.
   2. Member recommendation composer/feed and helpful feedback controls.
   3. Staff moderation routes + controls shipped (`approve/hide/restore`) with authz regression tests.
   4. Member feedback-note input shipped for richer peer context.
5. Cover quality enforcement advanced:
   1. import/refresh pipelines now emit cover quality flags.
   2. Staff cover review queue and resolution actions added to Lending operations.
6. External provider governance shipped:
   1. Staff-side provider hard-disable policy controls added in Staff -> Lending.
   2. External lookup broker now respects persisted provider policy and reports `policyLimited` + per-provider `disabled` diagnostics.
7. Community signals and moderation path expanded:
   1. member tag-submission write path shipped in Lending detail,
   2. staff tag moderation queue shipped (approve with canonical tag naming),
   3. staff tag-merge workflow shipped for duplicate taxonomy cleanup.
8. Post-write aggregate integrity improved:
   1. rating/review writes now trigger item-level community signal refresh,
   2. highest-rated catalog sorting now respects stored aggregate rating counts for tie-breaks.
9. Lending recovery operations shipped:
   1. staff backend routes for mark-lost, replacement-fee assessment, and item-status override,
   2. Staff -> Lending selected-loan recovery controls wired to those routes with auth mismatch and transition guardrails.
10. Overdue operations automation shipped:
   1. scheduled overdue sync with reminder-stage emission (`due_7d`, `due_1d`, `overdue_3d`),
   2. manual overdue sync trigger route for staff/admin operational runs.
11. Staff catalog admin path advanced (Staff -> Lending):
   1. create/edit/delete item workflow added in `web/src/views/StaffView.tsx`,
   2. ISBN resolve flow added with route-first call + external lookup fallback,
   3. destructive recovery actions now require confirmation prompts before request dispatch.
12. Lending write-safety and observability advanced:
   1. idempotency-key support added for checkout/check-in/mark-lost/replacement-fee routes,
   2. replay + key-conflict semantics added (`IDEMPOTENCY_KEY_CONFLICT`),
   3. standalone library job/manual endpoints now propagate `requestId` and emit structured run audit records.
13. Concurrency evidence advanced:
   1. checkout race regression added in `functions/src/apiV1.test.ts` asserting single-success behavior for one-copy inventory under concurrent requests.
14. Filtering/discovery continuity advanced:
   1. Lending search/filter/sort/item state now syncs with URL query params,
   2. back/forward navigation restores query state without reintroducing client-only ranking logic.
15. Human-experience UX pass advanced:
   1. detail view now includes a clear next-action bar (reserve/waitlist/return + notify),
   2. mobile detail action bar is sticky for thumb-reachable actions while reading metadata,
   3. browse header now exposes active-filter count + one-tap reset to reduce decision fatigue.
16. Phase-gated rollout operations advanced:
   1. runtime phase toggles now support read-only/member-write/admin-full progression without redeploys,
   2. Staff -> Lending includes a phase metrics snapshot panel (error/conflict/route-error/latency rollups),
   3. staff can copy structured metrics artifacts for phase gate evidence capture.
