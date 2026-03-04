# Hybrid Lending + Knowledge System Architecture

Status: Draft
Date: 2026-03-01
Owner: Library Ops + Platform + Member Experience
Scope: Portal member area (authenticated member/admin interactions only)

This document defines the production architecture for a curated, studio-native library system that supports physical lending and digital knowledge resources without adding operational noise.

## Architectural Decisions (Locked)

1. API boundary is role-aware and stateless (`Authorization: Bearer <idToken>` + existing role claims).
2. Persistence is relational (PostgreSQL) for lending lifecycle integrity, moderation workflows, and future recommendations.
3. ISBN scanning remains in admin item creation/edit flow and does not require a separate tool page.
4. Physical and digital media share one item model and one UI shell; only physical items enter borrow lifecycle.
5. Borrowing remains trust-based with soft reminders and admin-confirmed lost-item replacement charges.
6. Library routes are authenticated only; no public browse surface is exposed from the portal.
7. Browsing UX is functionality-first: primary decision fields must remain visually dominant over metadata chiplets.
8. Cover image policy: member-facing cards/details must use true front-cover imagery, not first-page scans.

## 1) High-Level System Architecture

### Runtime surfaces

- Frontend module: `Library` feature slice inside existing portal navigation.
- Backend module: `library` domain in API backend.
- Relational data plane: PostgreSQL with strict constraints and indexed discovery queries.
- Search plane: PostgreSQL full-text + trigram index for title/author/ISBN/tag/review queries.
- Jobs plane: scheduled soft reminders + overdue transitions + lightweight aggregate refresh.
- Payments plane: existing Stripe integration for lost-item replacement fee flow.

### Domain services

- `CatalogService`
  - Item CRUD (admin)
  - Discovery sections (`staff picks`, `recently added`, `most borrowed`, `recently reviewed`)
  - Search + filters + sorting
- `LendingService`
  - Checkout/check-in
  - Overdue/lost transitions
  - Lending eligibility enforcement
- `CommunityService`
  - Ratings (1-5, one per user/item)
  - Reviews (max 1000 chars)
  - Tag submissions + moderation hooks
  - Reading status tracking
- `IsbnIngestionService`
  - ISBN normalization (10/13)
  - Duplicate prevention
  - External metadata lookup + merge
  - Manual fallback path

### Data ownership boundaries

- Auth identity: existing portal auth provider (unchanged).
- Authorization: existing role claims + server-side policy checks (unchanged model, expanded capability matrix).
- Library domain data: relational store.
- Stripe state: existing billing integration; new references stored per lost-item transaction/donation.

## 2) Frontend Component Breakdown

`LibraryPageShell`
- Route shell for member/admin experiences.
- Owns search params, filter state, and data-fetch orchestration.

`LibrarySearchBar`
- Global query over title, author, tags, review text, and ISBN.

`LibraryFilterPanel`
- Collapsible on desktop and slide-out on mobile.
- Filters: media type, genre, studio relevance, availability, rating range.

`LibrarySortControl`
- Sort modes: highest rated, most borrowed, recently added, recently reviewed, staff picks.

`LibraryCoverGrid`
- Cover-first, calm density, minimal badges.
- Shared card for all media types.
- Card hierarchy prioritizes: cover -> title -> author -> availability -> primary action.

`LibraryItemDetailPanel`
- Expandable metadata + community context + interaction controls.

`MemberInteractionPanel`
- Borrow/check-in (physical only)
- Rate/review/tag/status actions

`AdminAddEditItemModal`
- Single creation/edit workflow with integrated ISBN scan/manual modes.

`AdminModerationPanel`
- Tag review/merge queue
- Lending override tools
- Lost-item fee assessment

## 3) Borrow Lifecycle Flow

### Physical lending states

- `available`
- `checked_out`
- `overdue`
- `lost`

### Core lifecycle

1. Member opens physical item detail and clicks checkout.
2. API validates role, item eligibility, and current availability.
3. System creates borrow transaction with:
   - `checked_out_at`
   - `due_at = checked_out_at + 28 days`
   - optional `suggested_donation_cents`
4. Item transitions to `checked_out`.
5. Reminder job emits soft reminders (no punitive copy):
   - 7 days before due date
   - 1 day before due date
   - 3 days after due date
6. If due date passes and not checked in, status becomes `overdue`.
7. Member self check-in closes transaction and returns item to `available`.
8. Lost path:
   - item marked `lost`
   - admin reviews and confirms replacement charge
   - Stripe payment flow executes
   - transaction records payment references and final status

## 4) Role-Based Permission Logic

| Capability | Member | Admin |
|---|---|---|
| Browse/search/filter library | yes | yes |
| View ratings/reviews/tags | yes | yes |
| Borrow/check-in physical books | yes | override + force state |
| Rate item (1-5, unique per item/user) | yes | yes |
| Create review | yes | yes |
| Submit tags | yes (moderated) | yes |
| Approve/merge tags | no | yes |
| Create/edit/delete items | no | yes |
| ISBN scan/import in add flow | no | yes |
| Mark lost + assess replacement fee | no | yes |
| Flag staff pick + curate shelves | no | yes |

Policy note: UI gating is convenience only; API remains the enforcement point.

## 5) ISBN Ingestion Flow

### Requirements coverage

- Accept ISBN-10 or ISBN-13.
- Normalize both forms and store normalized value for uniqueness.
- Check duplicate ISBN before persistence.
- Query metadata providers (Open Library first, Google Books fallback).
- Pre-fill title/author/cover/description/publisher/year/page count.
- Permit admin edits before save.
- If providers fail, continue with manual entry (scanner remains useful for captured ISBN).
- Run scheduled refresh for ISBN-backed items to recover missing covers/metadata over time.
- Enforce provider etiquette: request pacing, timeout budgets, retry/backoff on transient failures, and graceful degradation.

### Flow

1. Admin opens `Add Item` modal and chooses `Scan ISBN`.
2. Scanner (existing tooling) returns raw ISBN.
3. Backend normalizes ISBN and performs duplicate check.
4. Metadata lookup returns draft fields + source attribution.
5. Cover candidate passes quality rules (front-cover confidence); otherwise flagged for manual review.
6. Admin reviews/edits and submits.
7. Save validates unique ISBN index and writes item.
8. If remote lookup fails, UI falls back to manual entry mode with ISBN prefilled.
9. Scheduled backend refresh revisits stale/missing metadata and updates items without blocking member-facing requests.

## 6) UI Layout Wireframe Description

### Desktop

- Header row: page title, search, sort, admin add item button.
- Left rail: collapsible filters.
- Main panel: discovery rails and cover grid.
- Right slide panel or modal: item detail + metadata accordions + interaction controls.

### Mobile

- Top sticky row: search + sort.
- Filter drawer from bottom.
- Cover cards in 2-column responsive grid (single column on narrow devices).
- Item detail in full-height sheet with sticky action bar.

### UX style constraints

- Warm editorial look with clear hierarchy.
- Minimal badge clutter.
- No Goodreads-level noise.
- Member-only interactions are explicit and never rendered for unauthenticated users.
- Metadata chiplets are capped and never allowed to overpower title/author/availability.

## 7) Community Interaction Model

Members can:
- Rate (1-5, overwrite own rating)
- Leave one short review per item revision cycle (editable)
- Submit tags (moderated)
- Set reading status (`have`, `borrowed`, `want_to_read`, `recommended`)

System computes:
- aggregate rating
- most borrowed
- recently added
- recently reviewed
- staff picks

## 8) Operational + Safety Notes

- Keep all lending state transitions idempotent and server-controlled.
- Keep request/response contracts explicit JSON for web/native parity.
- Never write undefined fields; use null or omit.
- Preserve audit metadata on all admin and status-changing actions.
- Require admin confirmation before replacement-value Stripe charge execution.

## 9) Future Extensibility

Planned expansion points (schema and APIs already prepared):
- reading circles
- curated lists/shelves
- member reading profile pages
- recommendation engine (`if you liked this...`)
- multi-copy inventory tracking by physical copy barcode

## Companion Docs

- Schema: `docs/library/SCHEMA_RELATIONAL.md`
- API: `docs/library/API_CONTRACTS.md`
