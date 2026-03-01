# P1 — Library Frontend: Admin Library Management and ISBN Flow

Status: In Progress
Date: 2026-03-01
Priority: P1
Owner: Frontend UX + Library Ops + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Admin contracts cover catalog operations, moderation, and lending overrides, but frontend workflows for those operations are not unified and enforceability risks drift.

## Objective

Deliver a complete admin workspace for item CRUD, ISBN-assisted ingestion, moderation, and lending-state recovery that maps directly to admin API contracts.

## Scope

1. Admin add/edit/delete item workflows.
2. Integrated ISBN resolve flow inside add/edit modal.
3. Tag moderation queue with approve/merge actions.
4. Borrow recovery tools: mark lost, assess fee, override item status.
5. Admin-safe feedback and audit trace visibility.

## Role-Mode Behavior (Member/Admin + Unauthenticated Guard)

1. Unauthenticated users never render admin controls and are rejected/redirected from admin routes.
2. Member mode does not expose admin management actions and receives a forbidden guard if deep-linking is attempted.
3. Admin mode exposes full management, moderation, and override tooling with confirmation gates for destructive actions.

## Tasks

1. Build `AdminAddEditItemModal` form mapped to `POST /api/admin/library/items` and `PATCH /api/admin/library/items/:itemId`.
2. Add soft-delete confirmation flow for `DELETE /api/admin/library/items/:itemId` with post-delete catalog refresh.
3. Integrate ISBN resolver call to `POST /api/admin/library/items/resolve-isbn` with ISBN-10/13 normalization display and duplicate detection state.
4. Implement manual fallback path in add/edit form when ISBN provider lookup fails, preserving scanned ISBN value.
5. Add moderation queue UI for tag submissions and wire `POST /api/admin/library/tags/submissions/:submissionId/approve`.
6. Add duplicate tag merge flow with explicit source/target confirmation for `POST /api/admin/library/tags/:tagId/merge`.
7. Add borrow operations panel wiring `POST /api/admin/library/borrows/:borrowId/mark-lost`, `POST /api/admin/library/borrows/:borrowId/assess-replacement-fee`, and `POST /api/admin/library/items/:itemId/override-status`.
8. Ensure admin API requests include auth bearer token and optional dev `x-admin-token` header support through the existing portal debug path.
9. Consolidate staff ISBN intake UX inside Staff -> Lending (bulk import + quick scan) and remove staff ISBN controls from member-facing Lending page.

## Acceptance Criteria

1. Admin can create and edit library items from one modal workflow with contract-valid payloads and field validation.
2. ISBN resolve pre-fills metadata, surfaces provider source, and warns on duplicate ISBN before save.
3. If ISBN lookup fails, admin can still complete manual item creation with ISBN retained.
4. Soft-delete removes item from default catalog lists without hard-deleting data.
5. Tag submission approval and merge actions update moderation lists and canonical tag mapping without page reload.
6. Mark-lost and replacement-fee workflows require explicit confirmation before request dispatch.
7. Override-status action supports operational recovery while preventing invalid or stale UI state.
8. Non-admin users cannot access admin tooling through UI or route deep links and receive role-appropriate denial messaging.
9. Staff ISBN bulk import and scan workflows are available in Staff -> Lending and no longer duplicated in member-facing Lending UI.

## Execution Update (2026-03-01)

Implemented now (verified code paths):

1. Added a Staff -> Lending catalog admin workspace in `web/src/views/StaffView.tsx` under:
   - `Catalog admin (create/edit/delete + ISBN resolve)`
2. Added create/edit item workflow handlers:
   - `handleLendingAdminSave`
   - Route-first calls:
     - `apiV1/v1/library.items.create`
     - `apiV1/v1/library.items.update`
   - Firestore fallback path when admin routes are unavailable.
3. Added delete workflow handler:
   - `handleLendingAdminDelete`
   - Route-first call:
     - `apiV1/v1/library.items.delete`
   - Explicit confirmation phrase gate (`delete <itemId>`) plus confirm dialog.
   - Firestore soft-delete fallback (`deleted`, `deletedAt`, `status: archived`).
4. Added ISBN resolve flow in staff module:
   - `handleLendingAdminResolveIsbn`
   - Route-first call:
     - `apiV1/v1/library.items.resolveIsbn`
   - Fallback metadata resolve via `apiV1/v1/library.externalLookup`
   - Duplicate ISBN warning against loaded catalog rows.
5. Added destructive confirmation gates to lending recovery actions:
   - `handleLoanMarkLost` now confirms before dispatch.
   - `handleLoanAssessReplacementFee` now confirms amount/default before dispatch.
   - `handleLoanItemStatusOverride` now confirms status override before dispatch.

Previously implemented and still active:

1. Staff ISBN bulk import + scanner intake in Staff -> Lending.
2. Recommendation moderation queue (approve/hide/restore).
3. Tag moderation (approve canonical tag) + tag merge.
4. Provider diagnostics/policy controls and cover review queue guardrails.
5. Recovery route wiring for mark lost / replacement fee / override status.

Remaining before this ticket can move to Done:

1. Confirm backend-admin route contracts for create/update/delete/resolve ISBN and remove temporary route-name assumptions if they differ.
2. Add dedicated automated UI coverage for the new Staff catalog admin flows.
