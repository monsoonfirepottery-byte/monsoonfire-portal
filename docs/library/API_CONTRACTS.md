# Library API Contracts (Production Draft)

Status: Draft
Date: 2026-03-01
Owner: Platform + Library Ops

This document defines the API surface for the hybrid Lending Library feature.

## 1) Conventions

- Base path: `/api/library` (member/admin authenticated) and `/api/admin/library` (admin).
- Auth header: `Authorization: Bearer <idToken>` for authenticated routes.
- Existing admin compatibility header can remain available in dev paths: `x-admin-token`.
- Content type: `application/json`.
- IDs in responses use stable UUID `publicId` fields for client safety.
- Soft delete semantics: deleted records are excluded from default list endpoints.

## Implemented Firebase Function Route Mapping (2026-03-01)

Current implementation is exposed via `apiV1` route paths:
- `POST apiV1/v1/library.items.list`
- `POST apiV1/v1/library.items.get`
- `POST apiV1/v1/library.discovery.get`
- `POST apiV1/v1/library.externalLookup`
- `POST apiV1/v1/library.externalLookup.providerConfig.get` (admin/staff)
- `POST apiV1/v1/library.externalLookup.providerConfig.set` (admin/staff)
- `POST apiV1/v1/library.items.importIsbns` (admin/staff)
- `POST apiV1/v1/library.recommendations.list`
- `POST apiV1/v1/library.recommendations.create`
- `POST apiV1/v1/library.recommendations.feedback.submit`
- `POST apiV1/v1/library.recommendations.moderate` (admin/staff)
- `POST apiV1/v1/library.recommendations.feedback.moderate` (admin/staff)
- `POST apiV1/v1/library.ratings.upsert`
- `POST apiV1/v1/library.reviews.create`
- `POST apiV1/v1/library.reviews.update`
- `POST apiV1/v1/library.tags.submissions.create`
- `POST apiV1/v1/library.tags.submissions.approve` (admin/staff)
- `POST apiV1/v1/library.tags.merge` (admin/staff)
- `POST apiV1/v1/library.readingStatus.upsert`
- `POST apiV1/v1/library.loans.checkout`
- `POST apiV1/v1/library.loans.checkIn`
- `POST apiV1/v1/library.loans.listMine`
- `POST apiV1/v1/library.loans.markLost` (admin/staff)
- `POST apiV1/v1/library.loans.assessReplacementFee` (admin/staff)
- `POST apiV1/v1/library.items.overrideStatus` (admin/staff)

These routes map to the contract equivalents:
- `GET /api/library/items`
- `GET /api/library/items/:itemId`
- `GET /api/library/discovery`
- `POST /api/library/external-lookup`
- `GET /api/admin/library/external-lookup/provider-config`
- `PUT /api/admin/library/external-lookup/provider-config`
- `POST /api/admin/library/items` (ISBN-assisted batch import flow)
- `GET /api/library/recommendations`
- `POST /api/library/recommendations`
- `POST /api/library/recommendations/:recommendationId/feedback`
- `POST /api/admin/library/recommendations/:recommendationId/moderate`
- `POST /api/admin/library/recommendations/feedback/:feedbackId/moderate`
- `PUT /api/library/items/:itemId/rating`
- `POST /api/library/items/:itemId/reviews`
- `PATCH /api/library/reviews/:reviewId`
- `POST /api/library/items/:itemId/tags/submissions`
- `POST /api/admin/library/tags/submissions/:submissionId/approve`
- `POST /api/admin/library/tags/:tagId/merge`
- `PUT /api/library/items/:itemId/reading-status`
- `POST /api/library/items/:itemId/borrow`
- `POST /api/library/borrows/:borrowId/check-in`
- `GET /api/library/me/borrows`
- `POST /api/admin/library/borrows/:borrowId/mark-lost`
- `POST /api/admin/library/borrows/:borrowId/assess-replacement-fee`
- `POST /api/admin/library/items/:itemId/override-status`

## 2) Error Envelope

```json
{
  "ok": false,
  "code": "INVALID_ARGUMENT",
  "message": "Human-readable message",
  "details": {}
}
```

Common `code` values:
- `UNAUTHENTICATED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `INVALID_ARGUMENT`
- `FAILED_PRECONDITION`
- `INTERNAL`

## 3) Authenticated Read Endpoints

### `GET /api/library/items`

Returns browse catalog for authenticated member/admin callers only.

Query params:
- `q` (search string; title/author/tag/review/ISBN)
- `mediaType` (repeatable)
- `genre`
- `studioCategory` (repeatable)
- `availability` (`available|checked_out|overdue|lost`)
- `ratingMin`
- `ratingMax`
- `sort` (`highest_rated|most_borrowed|recently_added|recently_reviewed|staff_picks`)
- `page`
- `pageSize`

Response:
```json
{
  "ok": true,
  "items": [],
  "page": 1,
  "pageSize": 24,
  "total": 0
}
```

### `GET /api/library/items/:itemId`

Returns full item detail including metadata, aggregate ratings, tags, and availability snapshot.

### `GET /api/library/discovery`

Returns section data for:
- staff picks
- most borrowed
- recently added
- recently reviewed

Read policy note:
- unauthenticated callers are rejected (`401` or `403` depending on route gateway/auth layer).

## 4) Member Endpoints

### `POST /api/library/items/:itemId/borrow`

Physical items only.

Request:
```json
{
  "suggestedDonationCents": 500
}
```

Behavior:
- validates user role = member/admin
- validates item is lending-eligible and currently available
- creates borrow transaction with 4-week due date
- updates item availability

### `POST /api/library/borrows/:borrowId/check-in`

Self-service return for active borrower (admin override supported through admin endpoint).

### `PUT /api/library/items/:itemId/rating`

Upserts single rating per user per item.

Request:
```json
{
  "stars": 5
}
```

### `POST /api/library/items/:itemId/reviews`

Request:
```json
{
  "body": "Short review text..."
}
```

Validation:
- length 1-1000 chars

### `PATCH /api/library/reviews/:reviewId`

Member can edit own review.

### `POST /api/library/items/:itemId/tags/submissions`

Creates moderated tag submission.

Request:
```json
{
  "tag": "glaze testing"
}
```

### `PUT /api/library/items/:itemId/reading-status`

Request:
```json
{
  "status": "want_to_read"
}
```

Allowed values:
- `have`
- `borrowed`
- `want_to_read`
- `recommended`

### `GET /api/library/me/borrows`

Returns active + historical borrow timeline for current member.

## 5) Admin Endpoints

### `POST /api/admin/library/items`

Creates item manually or with prefilled ISBN metadata.

Validation notes:
- cover image must represent the object's true front cover (photo/illustration).
- first-page scans or inside-page imagery must be rejected or flagged for manual review.

### `PATCH /api/admin/library/items/:itemId`

Updates item metadata, replacement value, lending flags, staff pick, and curated fields.

### `DELETE /api/admin/library/items/:itemId`

Soft delete item.

### `POST /api/admin/library/items/resolve-isbn`

Resolves ISBN metadata in add/edit flow.

Additional behavior:
- return cover source and `needs_cover_review` when cover confidence is low.
- provider orchestration uses timeout/retry/pacing safeguards to avoid abusive upstream traffic.

Request:
```json
{
  "isbn": "9780131103627"
}
```

Response:
```json
{
  "ok": true,
  "source": "openlibrary",
  "draft": {
    "title": "...",
    "author": "...",
    "coverImageUrl": "...",
    "description": "...",
    "publisher": "...",
    "publicationYear": 1988,
    "pageCount": 274,
    "isbn10": "0131103628",
    "isbn13": "9780131103627"
  },
  "duplicate": false
}
```

### `POST /api/admin/library/items/refresh-metadata` (ops/manual trigger)

Triggers bounded refresh of stale ISBN-backed metadata for existing catalog rows.

Request:
```json
{
  "limit": 60,
  "staleMs": 1209600000
}
```

### `GET /api/admin/library/external-lookup/provider-config`

Returns current provider policy toggles used by the external lookup broker.

Response:
```json
{
  "ok": true,
  "data": {
    "openlibraryEnabled": true,
    "googlebooksEnabled": true,
    "disabledProviders": [],
    "note": null,
    "updatedAtMs": 0,
    "updatedByUid": null
  }
}
```

### `PUT /api/admin/library/external-lookup/provider-config`

Updates provider enable-disable policy without deploys.

Request:
```json
{
  "openlibraryEnabled": false,
  "googlebooksEnabled": true,
  "note": "Temporary pause due provider error budget."
}
```

Response:
```json
{
  "ok": true,
  "data": {
    "openlibraryEnabled": false,
    "googlebooksEnabled": true,
    "disabledProviders": ["openlibrary"],
    "note": "Temporary pause due provider error budget.",
    "updatedAtMs": 1730486400000,
    "updatedByUid": "staff_123"
  }
}
```

Operational notes:
- scheduled refresh runs automatically on interval for stale/missing metadata.
- manual trigger is rate-limited and staff/admin scoped.
- current portal implementation exposes this operation via function route `runLibraryMetadataRefreshNow`.

### `POST /api/admin/library/borrows/sync-overdue` (ops/manual trigger)

Triggers immediate overdue sync and reminder-stage emission.

Request:
```json
{
  "limit": 320
}
```

Operational notes:
- scheduled overdue sync runs automatically on interval.
- reminder stages emit idempotently:
  - `library.borrow_due_7d`
  - `library.borrow_due_1d`
  - `library.borrow_overdue_3d`
- current portal implementation exposes this operation via function route `runLibraryOverdueSyncNow`.

### `POST /api/admin/library/tags/submissions/:submissionId/approve`

Approves a tag submission and links/creates canonical tag.

### `POST /api/admin/library/tags/:tagId/merge`

Request:
```json
{
  "targetTagId": "..."
}
```

Merges duplicate tags into canonical target.

### `POST /api/admin/library/borrows/:borrowId/mark-lost`

Marks active borrow as lost and snapshots replacement value.

### `POST /api/admin/library/borrows/:borrowId/assess-replacement-fee`

Admin-confirmed Stripe-ready replacement fee flow.

Request:
```json
{
  "confirm": true,
  "amountCents": 4200,
  "note": "Member confirmed item lost."
}
```

### `POST /api/admin/library/items/:itemId/override-status`

Manual status correction for operational recovery.

## 6) Borrow State Transition Rules

Allowed transitions:
- `available` -> `checked_out`
- `checked_out` -> `available` (check-in)
- `checked_out` -> `overdue` (scheduler)
- `overdue` -> `available` (check-in)
- `checked_out` -> `lost` (admin/member report)
- `overdue` -> `lost` (admin)
- `lost` -> `available` (admin override only)

Rejected transitions return `409 CONFLICT` with machine-readable reason code.

## 7) Discovery + Filtering Contract

All list endpoints must support:
- text search over title/author/tag/review/ISBN
- media-type filtering
- genre filtering
- studio relevance filtering
- availability filtering
- rating-range filtering
- deterministic sort options

Server is authoritative for filtering/sorting to keep web and iOS parity.

## 8) Notification Contract (Soft Reminder Tone)

Reminder events emitted by backend job:
- `library.borrow_due_7d`
- `library.borrow_due_1d`
- `library.borrow_overdue_3d`

Guidance:
- language is trust-based
- no punitive copy
- include self-service check-in path

## 9) Observability Requirements

Every write endpoint emits:
- request id
- actor user id
- role
- action
- entity id
- before/after summary
- outcome (`success|rejected|error`)

Critical alerts:
- duplicate ISBN insertion conflicts
- lost-item fee charge failures
- stuck overdue transition jobs
