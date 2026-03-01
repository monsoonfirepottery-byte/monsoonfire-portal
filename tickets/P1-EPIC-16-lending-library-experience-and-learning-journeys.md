# P1 — EPIC 16: Lending Library Experience and Learning Journeys

Status: In Progress (Reopened)
Date: 2026-03-01
Priority: P1
Owner: Library Ops + Program Ops + Member Experience
Type: Epic Ticket
Parent Epic: docs/epics/EPIC-LENDING-LIBRARY-EXPERIENCE-AND-LEARNING-JOURNEYS.md

## Problem

Lending currently behaves as a static listing/request flow with limited educational guidance, low engagement loops, and weak linkage to workshops.

## Objective

Deliver a richer lending experience that acts as a learning system, not only an inventory list, while keeping browsing functionality-first and visually calm.

## Scope

1. Recommendations and curated pathways.
2. Technique-workshop linkage and demand capture.
3. Member engagement signals and richer lifecycle UX.
4. Design pass for visual quality and reactivity.
5. Functional browse-and-selection UX path with reduced metadata chiplet overload.
6. Cover-photo quality enforcement and backfill for all library objects.

## Tasks

1. Ship all child tickets in this epic.
2. Keep data and UX contracts consistent across Lending, Workshops, and Staff operations.
3. Validate with member and staff QA workflows before rollout.
4. Apply interaction pattern references from established library/media browse surfaces (for decision clarity) while preserving Monsoon Fire identity.

## Acceptance Criteria

1. Child tickets are implemented with no regression in core reserve/waitlist flows.
2. Technique and workshop cross-linking works in both directions.
3. Staff can view and act on workshop demand generated from lending interactions.
4. Member-facing surfaces feel materially more curated and actionable.
5. Catalog/detail surfaces prioritize cover/title/author/availability over dense chiplet metadata.
6. Library objects use true cover imagery (not first-page scans), with unresolved items routed to review workflow.

## Historical Note (2026-02-28, Superseded)

1. A prior snapshot marked the epic complete.
2. This is no longer the active status; Epic 16 is reopened and remains `In Progress`.
3. Treat current execution updates and child-ticket status as source of truth.

## Reopen Note (2026-03-01)

Epic reopened for an additional UI/UX and catalog-media quality path:
1. `tickets/P1-library-frontend-functional-browse-and-selection-ux-path.md`
2. `tickets/P1-library-cover-photo-quality-and-backfill.md`
3. `tickets/P1-library-community-recommendations-and-peer-feedback.md`

## Execution Update (2026-03-01)

1. Internal UX A/B evaluation selected a functionality-first workflow:
   1. Cover-first browse hierarchy.
   2. Progressive metadata disclosure.
   3. Quiet/collapsible filtering controls.
2. Public read surface is removed from epic execution scope; library routes remain authenticated (member/admin only).
3. Staff ISBN bulk import and quick-scan intake are consolidated in Staff -> Lending operations UI.
4. Added a new community recommendation ticket so clients can recommend titles and gather peer feedback:
`tickets/P1-library-community-recommendations-and-peer-feedback.md`.
5. Added an external-source discovery fallback ticket for local search misses with policy-safe provider usage:
`tickets/P2-library-external-source-discovery-and-fulfillment-handoff.md`.
6. Community recommendation moderation path shipped:
   1. backend moderation routes + authz hardening,
   2. staff moderation controls in Staff -> Lending,
   3. member feedback-note UX and visibility safety rules.
7. External provider governance path shipped:
   1. staff provider policy toggles (Open Library / Google Books),
   2. broker policy-aware suppression + diagnostics (`policyLimited`, `disabled`),
   3. provider policy regression tests.
8. Community moderation and taxonomy path advanced:
   1. member tag submission flow shipped in Lending detail,
   2. staff tag moderation queue + canonical-tag approval shipped in Staff -> Lending,
   3. staff tag-merge controls shipped for duplicate taxonomy cleanup.
9. Community signal integrity path advanced:
   1. backend now refreshes item-level aggregates after rating/review writes,
   2. highest-rated tie-break now honors stored aggregate rating counts.
10. Lending recovery operations advanced:
   1. backend staff routes added for mark-lost, replacement-fee assessment, and item-status override,
   2. Staff -> Lending selected-loan panel now exposes those actions with guardrails.
11. Overdue automation path advanced:
   1. scheduled overdue sync + reminder-stage emission implemented in backend,
   2. manual overdue sync ops trigger added for controlled staff/admin runs.
12. Staff catalog admin execution evidence added:
   1. Staff -> Lending now includes item create/edit/delete workflow in `web/src/views/StaffView.tsx`,
   2. ISBN resolve flow now exists in staff module with route-first + fallback behavior,
   3. mark-lost / replacement-fee / override operations now include confirmation prompts.
13. Backend write-safety + observability advanced:
   1. idempotency support now covers checkout/check-in/mark-lost/replacement-fee write routes,
   2. key-reuse conflict semantics now return contract-aligned `CONFLICT` with `IDEMPOTENCY_KEY_CONFLICT`,
   3. standalone library ops endpoints and scheduled jobs now emit request-id-correlated structured run audit logs.
14. Lending concurrency evidence advanced:
   1. new checkout race regression test now validates one-success/one-conflict behavior for single-copy inventory contention.
15. Filtering/search continuity advanced:
   1. Lending query state now round-trips through URL params (search/filter/sort + selected item),
   2. browser back/forward restores catalog state without stale client-side filtering assumptions.
16. Human-experience UX pass advanced:
   1. detail surface now includes an explicit next-action bar (reserve/waitlist/return + notify),
   2. mobile detail action bar made sticky for in-context actions,
   3. active-filter summary + one-tap reset added to reduce browse friction.
17. Phased rollout controls and operator evidence advanced:
   1. runtime phase toggles now gate library write surfaces without deploys,
   2. Staff -> Lending now includes a phase metrics snapshot with error/conflict/route-error/latency rollups,
   3. staff can copy a structured phase metrics JSON artifact for release gate evidence.
