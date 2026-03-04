# P1 — Lending Library: Local ISBN Reference Catalog + Remote Fallback

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Library Ops + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

ISBN imports currently rely on remote metadata providers. When those providers are unavailable or rate-limited, imports degrade and canary/test reliability suffers.

## Objective

Add an offline-first local ISBN reference catalog for known titles while preserving Open Library and Google Books as fallback sources.

## Scope

1. Local ISBN reference dataset embedded in import path.
2. Deterministic source attribution for local matches.
3. Remote lookup fallback when local catalog has no match.

## Tasks

1. Define local reference catalog structure and seed baseline ISBN entries.
2. Resolve imports against local catalog before remote calls.
3. Preserve current remote merge/fallback path for non-local ISBNs.
4. Keep source metadata explicit for diagnostics (`local_reference`, `openlibrary`, `googlebooks`, `manual`).

## Acceptance Criteria

1. Known ISBNs import successfully without network dependency.
2. Unknown ISBNs still resolve through remote providers when available.
3. Import metadata clearly identifies whether local or remote source was used.
4. Existing import endpoint behavior remains backward compatible.

## Completion Evidence (2026-02-27)

- Added local reference catalog and lookup path in [`functions/src/library.ts`](/home/wuff/monsoonfire-portal/functions/src/library.ts).
- Import now checks local catalog first (`source: local_reference`) before calling Open Library and Google Books.
- Existing remote merge behavior and manual fallback remain intact for non-local ISBNs.
