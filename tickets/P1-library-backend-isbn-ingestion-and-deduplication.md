# P1 — Library Backend: ISBN Ingestion and Deduplication

Status: In Progress
Date: 2026-03-01
Priority: P1
Owner: Platform Backend + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

ISBN import and item creation paths need stronger normalization, duplicate prevention, and source traceability to avoid catalog drift and operator rework.

## Objective

Implement a resilient ISBN ingestion/admin item flow with deterministic normalization, duplicate detection, and provider fallback behavior.

## Scope

1. Contract mapping (API): `docs/library/API_CONTRACTS.md` sections 5 and 9 for:
- `POST /api/admin/library/items/resolve-isbn`
- `POST /api/admin/library/items`
- `PATCH /api/admin/library/items/:itemId`
- `DELETE /api/admin/library/items/:itemId`
2. Contract mapping (schema): `docs/library/SCHEMA_RELATIONAL.md` sections 3 and 7 using:
- `library_items` ISBN fields (`isbn10`, `isbn13`, `isbn_normalized`)
- active-row ISBN uniqueness index (`ux_library_items_isbn_active`)
- relevant search indexes for normalized ISBN lookup
3. Admin create/update flows that preserve stable `publicId` and soft-delete semantics.
4. Source attribution for ISBN resolution responses (`openlibrary`, `googlebooks`, `manual`, local source where configured).
5. Conflict-safe behavior when duplicates are detected during resolve/create/update operations.
6. Scheduled metadata refresh workflow for existing ISBN-backed items (covers + descriptive fields) with provider-safe request behavior.

## Tasks

1. Add shared ISBN normalization utility (strip non-digit/X noise, validate length/check-digit where applicable, compute canonical `isbn_normalized`).
2. Implement `POST /api/admin/library/items/resolve-isbn` with provider orchestration, deterministic source attribution, and `duplicate` detection against active catalog rows.
3. Implement admin item-create path that accepts prefilled ISBN metadata and returns conflict errors when an active duplicate exists.
4. Implement admin item-update path with dedup guardrails for ISBN edits and partial metadata updates.
5. Implement soft-delete endpoint so deleted rows are excluded from default catalog queries while preserving auditability.
6. Add structured conflict detail payloads to identify existing canonical item on duplicate ISBN attempts.
7. Add test coverage for valid ISBNs, invalid ISBNs, provider miss/fallback, duplicate conflicts, and post-soft-delete re-ingestion behavior.
8. Add scheduled refresh process (`refreshLibraryIsbnMetadata`) plus admin-triggered manual run path for controlled backfills.
9. Implement provider etiquette controls for remote lookups:
   - timeout budgets
   - retry/backoff for 429/5xx/transient failures
   - pacing between provider calls
   - payload minimization and cache-friendly behavior

## Acceptance Criteria

1. ISBN resolve endpoint returns contract shape with `source`, `draft` metadata, and `duplicate` boolean.
2. Active duplicate ISBN creation/update attempts are rejected with contract-compliant conflict responses.
3. Soft-deleted items do not block re-creation of the same ISBN due to active-row uniqueness semantics.
4. Admin create/update/delete paths preserve audit fields and soft-delete behavior defined in schema conventions.
5. ISBN normalization is applied consistently across resolve/create/update paths.
6. Source attribution is persisted/logged for operator diagnostics and incident response.
7. Automated tests cover success, conflict, and fallback paths for ISBN ingestion.
8. Scheduled refresh updates stale/missing metadata without blocking request paths and can be manually triggered by staff/admin.
9. Provider request behavior is resilient and policy-aware, reducing risk of quota abuse or provider throttling.

## Execution Update (2026-03-01)

Completed in this slice:
1. Implemented ISBN batch import + dedup guardrails in `functions/src/library.ts` via `importLibraryIsbnBatch`.
2. Implemented local-reference-first lookup with remote provider fallback and persisted source attribution.
3. Added provider etiquette controls (timeout/retry/backoff/pacing) and cache-aware lookup behavior.
4. Added scheduled metadata refresh pipeline (`refreshLibraryIsbnMetadata`) with cover-quality re-evaluation.
5. Added admin/staff API route `POST /v1/library.items.importIsbns` in `functions/src/apiV1.ts`.
6. Aligned legacy `importLibraryIsbns` authorization with staff workflows (staff allowed, not only full admin) to keep fallback behavior consistent with v1 route.
