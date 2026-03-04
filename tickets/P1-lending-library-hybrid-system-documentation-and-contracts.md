# P1 — Lending Library: Hybrid System Documentation and Contracts

Status: In Progress
Date: 2026-03-01
Priority: P1
Owner: Library Ops + Platform + Member Experience
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

The lending feature has shipped iteratively, but architecture, schema, and API decisions for the next-stage hybrid system are not centralized in one durable docs package.

## Objective

Create a production-ready documentation set that defines architecture, relational schema, and API contracts for a hybrid physical + digital lending and knowledge system.

## Scope

1. Define high-level architecture and UX system model.
2. Define relational schema with constraints and lifecycle rules.
3. Define member/admin API contracts.
4. Link docs into existing docs + epic structure for discoverability.

## Tasks

1. Add `docs/library/README.md` as entrypoint and decision registry.
2. Add `docs/library/ARCHITECTURE.md` with role model, lifecycle, ISBN flow, and UX wireframe guidance.
3. Add `docs/library/SCHEMA_RELATIONAL.md` with required tables, indexes, soft deletes, and audit fields.
4. Add `docs/library/API_CONTRACTS.md` for endpoint-level contract design.
5. Link docs in `docs/README.md` and epic record.

## Acceptance Criteria

1. Docs exist under `docs/library/` and cover architecture, schema, and API contracts.
2. Schema includes `Users`, `LibraryItems`, `BorrowTransactions`, `Reviews`, `Ratings`, `Tags`, `ItemTags`, `UserReadingStatus`, and `Donations`.
3. Contracts include authenticated member/admin role boundaries.
4. ISBN ingestion contract supports scan + metadata fetch + manual fallback.
5. Docs are linked from top-level docs and Lending epic.

## Execution Evidence (2026-03-01)

Verified in-repo documentation artifacts:

1. Library docs pack exists under `docs/library/` with:
   - `README.md`
   - `ARCHITECTURE.md`
   - `SCHEMA_RELATIONAL.md`
   - `API_CONTRACTS.md`
2. Epic/ticket cross-linking is present in:
   - `docs/epics/EPIC-LENDING-LIBRARY-EXPERIENCE-AND-LEARNING-JOURNEYS.md`
   - `tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md`
3. `docs/README.md` now includes a direct link to the library docs pack entrypoint (`docs/library/README.md`).

Status guardrail:

1. This documentation ticket remains `In Progress` until link hygiene, contract parity checks, and rollout docs acceptance are fully validated in review.

## Subtask Swarm Plan (2026-03-01)

### Phase 1 — Data + Authenticated Read Foundation

1. Add SQL migration stubs:
- `studio-brain/migrations/006_library_core.sql`
- `studio-brain/migrations/007_library_community.sql`
- `studio-brain/migrations/008_library_lending_and_ops.sql`
2. Implement backend read APIs:
- `tickets/P1-library-backend-catalog-and-discovery-api-v1.md`
3. Implement frontend member discovery surface:
- `tickets/P1-library-frontend-member-catalog-and-discovery-experience.md`

### Phase 2 — Member Interaction Activation

1. Implement backend lending lifecycle:
- `tickets/P1-library-backend-lending-lifecycle-and-overdue-ops.md`
2. Implement backend community signals/moderation:
- `tickets/P1-library-backend-community-signals-and-tag-moderation.md`
3. Implement frontend member interactions:
- `tickets/P1-library-frontend-member-interactions-and-reading-state.md`
4. Implement filtering/mobile quality pass:
- `tickets/P2-library-frontend-filtering-search-and-mobile-polish.md`

### Phase 3 — Admin Operations + Hardening + Cutover

1. Implement backend ISBN ingestion/dedupe:
- `tickets/P1-library-backend-isbn-ingestion-and-deduplication.md`
2. Implement frontend admin management + ISBN workflow:
- `tickets/P1-library-frontend-admin-library-management-and-isbn-flow.md`
3. Add backend observability/audit safeguards:
- `tickets/P2-library-backend-observability-audit-and-safeguards.md`
4. Run phased release execution:
- `tickets/P2-library-release-plan-phased-rollout-and-cutover.md`
