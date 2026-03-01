# P2 — Library Release Plan: Phased Rollout and Cutover

Status: In Progress
Date: 2026-03-01
Priority: P2
Owner: Product + Frontend + Platform + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

The hybrid library feature spans authenticated discovery, member writes, and admin operations, so a single-step launch increases risk of contract drift and operational surprises.

## Objective

Define a three-phase rollout and cutover plan with explicit go/no-go gates, monitoring expectations, and rollback triggers tied to authenticated role-aware feature surfaces.

## Scope

1. Phase sequencing for authenticated read, member write, and admin capability activation.
2. Gate criteria for correctness, reliability, and operational readiness.
3. Rollback triggers and owner actions per phase.
4. Release evidence checklist and cutover communication steps.

## Role-Mode Behavior (Member/Admin + Unauthenticated Guard)

1. Unauthenticated access to library routes is blocked in all phases; no public browse mode is shipped.
2. Member mode activates as read-first in Phase 1, then member writes in Phase 2.
3. Admin mode activates in Phase 3 after member-write and moderation gates pass.

## Phase Plan

### Phase 1 — Authenticated Discovery Read Rollout

1. Enable `GET /api/library/discovery`, `GET /api/library/items`, and `GET /api/library/items/:itemId` for authenticated member/admin users.
2. Keep all write actions disabled behind role-gated UI and route guards.
3. Gate criteria: read endpoint error rate under 1%, no white-screen incidents, and successful QA across desktop/mobile member/admin mode.
4. Rollback trigger: sustained read endpoint failure above gate threshold for 30 minutes or repeated runtime crashes in library route.

### Phase 2 — Member Interaction Activation

1. Enable member write endpoints for borrow/check-in/rating/review/tag submission/reading-status.
2. Keep admin override and moderation actions disabled except for internal test admins.
3. Gate criteria: successful member lifecycle tests for borrow to check-in, conflict handling for invalid transitions, and no unhandled contract errors in member UI.
4. Rollback trigger: borrow/check-in failure rate above 2%, data integrity mismatch in borrow timeline, or widespread `CONFLICT` misclassification caused by UI payload errors.

### Phase 3 — Admin Management and Cutover

1. Enable admin item CRUD, ISBN resolve flow, moderation queue actions, and lending override endpoints.
2. Move operational runbook ownership to Library Ops with platform on-call escalation routing.
3. Gate criteria: admin smoke pass for create/edit/delete, duplicate ISBN handling, tag moderation, mark-lost and fee assessment confirmation, and observability event completeness.
4. Rollback trigger: critical admin action failure blocking operational recovery, replacement-fee flow failures, or missing audit traces for status-changing writes.

## Tasks

1. Add phase flags/config toggles to frontend feature gates for authenticated read, member writes, and admin management controls.
2. Define pre-release smoke checklist per phase with explicit role-mode test accounts and endpoint expectations.
3. Add dashboard/report view for phase metrics: error rate, conflict rate, runtime route errors, and critical endpoint latency.
4. Document rollback execution sequence including which flags to disable and how to verify safe-state restoration.
5. Publish cutover communication template for staff and members, including expected behavior changes by phase.
6. Attach phase evidence artifacts to release record before progressing to next phase.

## Acceptance Criteria

1. Phase 1, 2, and 3 each have documented enablement scope, gate criteria, and rollback triggers.
2. Release owner can enable/disable phase capabilities without code changes.
3. Role-mode behavior is explicit and testable for each phase transition.
4. Rollback procedure is executable in under 15 minutes and restores prior stable role behavior.
5. Cutover cannot advance phases without captured evidence against the defined gates.

## Execution Update (2026-03-01, Deep Pass)

Completed in this pass:
1. Core phase dependencies are now materially de-risked:
   - authenticated-only read surface,
   - member write lifecycle + idempotency safeguards,
   - staff admin management and moderation workflows,
   - request-id correlation + structured run auditing for manual/scheduled ops jobs.
2. Catalog/discovery UX now supports URL-round-trippable query state and mobile sticky action ergonomics, improving phased QA reproducibility.
3. Added explicit execution evidence across child tickets for:
   - backend lifecycle concurrency test coverage,
   - member/admin UX workflow readiness,
   - cover-quality gating and placeholder behavior.

Remaining before ticket can close:
1. Execute authenticated browser QA pass and cutover rehearsal with rollback drill timing evidence.

## Execution Update (2026-03-01, Rollout Controls + Metrics Snapshot)

Completed in this pass:
1. Added runtime rollout phase controls (`phase_1_read_only`, `phase_2_member_writes`, `phase_3_admin_full`) with staff-controlled set/get routes and route-level write gating.
2. Added staff-side rollout controls in `Staff -> Lending` with explicit phase selector, metadata visibility, and phase status messaging.
3. Added operator-facing phase metrics snapshot artifact in `Staff -> Lending`:
   - request count,
   - error/conflict/route-error totals + rates,
   - p50/p95/max latency rollups,
   - endpoint-level breakdown for critical routes.
4. Added one-click JSON artifact copy action for attaching phase evidence to release records.
5. Added telemetry duration capture in both API clients so latency metrics are based on real request durations.
