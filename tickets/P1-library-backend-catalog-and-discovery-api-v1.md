# P1 — Library Backend: Catalog and Discovery API v1

Status: In Progress
Date: 2026-03-01
Priority: P1
Owner: Platform Backend + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Catalog and discovery behavior is currently fragmented, which creates inconsistent search/filter results across clients and makes production debugging difficult.

## Objective

Ship a contract-accurate, server-authoritative catalog/discovery API layer with deterministic filtering, sorting, pagination, and stable detail payloads for web and future iOS clients.

## Scope

1. Contract mapping (API): `docs/library/API_CONTRACTS.md` sections 1, 2, 3, and 7 for:
- `GET /api/library/items`
- `GET /api/library/items/:itemId`
- `GET /api/library/discovery`
2. Contract mapping (schema): `docs/library/SCHEMA_RELATIONAL.md` sections 3, 4, 6, and 7 using:
- `library_items`, `media_types`, `studio_relevance_categories`
- `ratings`, `reviews`, `tags`, `item_tags`
- `library_item_stats`
- documented search and supporting indexes
3. Deterministic query behavior for `q`, `mediaType`, `genre`, `studioCategory`, `availability`, `ratingMin`, `ratingMax`, and `sort`.
4. Public-safe DTOs using `publicId` and exclusion of soft-deleted rows by default.
5. Discovery rail assembly for staff picks, most borrowed, recently added, and recently reviewed.

## Tasks

1. Implement `GET /api/library/items` with allow-listed query params, strict validation, stable tie-break sorting, and bounded pagination.
2. Implement full-text + trigram-backed search coverage over title/author/description plus joins for tag/review/ISBN matching.
3. Implement `GET /api/library/items/:itemId` with aggregate rating/review/tag and availability snapshot fields from canonical tables/stats.
4. Implement `GET /api/library/discovery` with independent section queries and deterministic item ordering per section.
5. Add SQL/index migration alignment for documented index strategy and verify explain plans for high-cardinality catalog queries.
6. Add contract tests for filter combinations, empty results, invalid params, and pagination consistency.
7. Add response contract assertions for the standard error envelope and stable `publicId`-first payload fields.

## Acceptance Criteria

1. All three read endpoints match the API contract paths, query semantics, and response shapes in `docs/library/API_CONTRACTS.md`.
2. Search returns expected matches for title, author, tag, review body, and normalized ISBN queries.
3. Sorting and pagination are deterministic across repeated requests with identical parameters.
4. Soft-deleted rows are excluded from all list/detail responses by default.
5. Discovery response includes all four required sections: staff picks, most borrowed, recently added, and recently reviewed.
6. Schema dependencies and indexes referenced in `docs/library/SCHEMA_RELATIONAL.md` are implemented and exercised by backend tests.
7. Validation failures and unsupported sort/filter values return contract-compliant error envelopes.
