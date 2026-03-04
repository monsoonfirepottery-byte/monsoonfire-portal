# Lending Library Documentation Set

Status: Draft (documentation track started)
Date: 2026-03-01
Owner: Library Ops + Platform + Member Experience

This folder defines the production architecture for the next-stage hybrid Lending Library system:
- curated physical lending,
- digital learning resources,
- community knowledge signals,
- and trust-based studio operations.

## Linked Epic + Tickets

- Epic: `docs/epics/EPIC-LENDING-LIBRARY-EXPERIENCE-AND-LEARNING-JOURNEYS.md`
- Ticket: `tickets/P1-lending-library-reactive-discovery-and-staff-curation.md`
- Ticket: `tickets/P1-lending-library-local-isbn-reference-catalog-and-remote-fallback.md`
- Ticket: `tickets/P1-lending-library-member-learning-signals-and-reviews.md`
- Ticket: `tickets/P1-lending-library-lifecycle-ux-and-operational-feedback.md`
- Ticket: `tickets/P1-lending-library-technique-to-workshop-pathway.md`
- Ticket: `tickets/P2-lending-library-frontend-design-and-motion-pass.md`

## Document Map

1. `docs/library/ARCHITECTURE.md`
   End-to-end architecture, UX system direction, role model, borrow lifecycle, and ISBN ingestion flow.
2. `docs/library/SCHEMA_RELATIONAL.md`
   Relational schema (tables, keys, constraints, indexes, soft delete, audit, and lifecycle tracking).
3. `docs/library/API_CONTRACTS.md`
   Member/admin API contracts and state-transition rules.
4. `docs/library/ROLLOUT_CUTOVER_RUNBOOK.md`
   Phase smoke checklist, rollback drill steps, metrics artifact capture, and cutover communication templates.

## Decision Rules

- Keep Member/Admin access boundaries explicit in every contract.
- Keep physical lending rules trust-based and operationally lightweight.
- Keep API contracts stateless and client-agnostic (web now, iOS-ready).
- Preserve existing ISBN tooling behavior while modernizing admin workflows.
- Keep extension points explicit for reading circles, curated lists, and recommendations.

## Execution Tickets (2026-03-01)

- `tickets/P1-lending-library-hybrid-system-documentation-and-contracts.md`
- `tickets/P1-library-backend-catalog-and-discovery-api-v1.md`
- `tickets/P1-library-backend-lending-lifecycle-and-overdue-ops.md`
- `tickets/P1-library-backend-community-signals-and-tag-moderation.md`
- `tickets/P1-library-backend-isbn-ingestion-and-deduplication.md`
- `tickets/P2-library-backend-observability-audit-and-safeguards.md`
- `tickets/P1-library-frontend-member-catalog-and-discovery-experience.md`
- `tickets/P1-library-frontend-member-interactions-and-reading-state.md`
- `tickets/P1-library-frontend-admin-library-management-and-isbn-flow.md`
- `tickets/P1-library-frontend-functional-browse-and-selection-ux-path.md`
- `tickets/P1-library-cover-photo-quality-and-backfill.md`
- `tickets/P2-library-frontend-filtering-search-and-mobile-polish.md`
- `tickets/P2-library-release-plan-phased-rollout-and-cutover.md`

## Migration Stubs (2026-03-01)

- `studio-brain/migrations/006_library_core.sql`
- `studio-brain/migrations/007_library_community.sql`
- `studio-brain/migrations/008_library_lending_and_ops.sql`
