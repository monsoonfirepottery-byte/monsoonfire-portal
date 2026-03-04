# Library Relational Schema (Production Draft)

Status: Draft
Date: 2026-03-01
Owner: Platform + Library Ops
Database: PostgreSQL 15+

This schema is optimized for:
- lending lifecycle integrity,
- community interaction depth,
- moderation workflows,
- and future recommendation/reading-circle expansion.

## 1) Conventions

### Naming

- SQL tables use `snake_case`.
- API payloads may expose `camelCase` DTOs.
- Canonical table mapping requested by product:
  - `Users` -> `users`
  - `LibraryItems` -> `library_items`
  - `BorrowTransactions` -> `borrow_transactions`
  - `Reviews` -> `reviews`
  - `Ratings` -> `ratings`
  - `Tags` -> `tags`
  - `ItemTags` -> `item_tags`
  - `UserReadingStatus` -> `user_reading_status`
  - `Donations` -> `donations`

### Shared audit + soft delete fields

All mutable domain tables include:
- `created_at timestamptz not null default now()`
- `created_by bigint null references users(id)`
- `updated_at timestamptz not null default now()`
- `updated_by bigint null references users(id)`
- `deleted_at timestamptz null`
- `deleted_by bigint null references users(id)`

## 2) Reference Tables

### `users`

- `id bigserial primary key`
- `auth_uid text not null unique`
- `email text null`
- `display_name text null`
- `role text not null check (role in ('member','admin'))`
- `stripe_customer_id text null`

### `media_types`

- `id smallserial primary key`
- `code text not null unique`
- `label text not null`
- `lending_supported boolean not null default false`

Seed values:
- `physical_book` (`lending_supported = true`)
- `digital_book`
- `external_link`
- `video_course`
- `studio_document`

### `studio_relevance_categories`

- `id smallserial primary key`
- `code text not null unique`
- `label text not null`

Seed values:
- `ceramics_technique`
- `glaze_chemistry`
- `kiln_theory`
- `studio_business`
- `creativity`
- `philosophy`
- `mental_health`
- `design`
- `fiction`

## 3) Core Catalog Tables

### `library_items`

- `id bigserial primary key`
- `public_id uuid not null unique`
- `title text not null`
- `author text not null`
- `isbn10 text null`
- `isbn13 text null`
- `isbn_normalized text null`
- `cover_image_url text null`
- `description text null`
- `publisher text null`
- `publication_year int null`
- `page_count int null`
- `media_type_id smallint not null references media_types(id)`
- `primary_genre text null`
- `studio_relevance_category_id smallint null references studio_relevance_categories(id)`
- `replacement_value_cents int null check (replacement_value_cents >= 0)`
- `lending_eligible boolean not null default false`
- `current_lending_status text not null default 'available' check (current_lending_status in ('available','checked_out','overdue','lost'))`
- `staff_pick boolean not null default false`
- `added_by bigint not null references users(id)`
- `date_added timestamptz not null default now()`

Constraints:
- `check ((lending_eligible = true and media_type_id in (select id from media_types where lending_supported = true)) or lending_eligible = false)`

Unique ISBN index (active rows only):
```sql
create unique index ux_library_items_isbn_active
  on library_items (isbn_normalized)
  where isbn_normalized is not null and deleted_at is null;
```

### `item_assets` (optional but recommended)

- `id bigserial primary key`
- `item_id bigint not null references library_items(id)`
- `asset_type text not null check (asset_type in ('pdf','link','video','doc'))`
- `url text not null`
- `title text null`
- `position int not null default 0`

Used to attach digital resources while keeping a unified item model.

## 4) Community Tables

### `ratings`

- `id bigserial primary key`
- `item_id bigint not null references library_items(id)`
- `user_id bigint not null references users(id)`
- `stars smallint not null check (stars between 1 and 5)`

Constraint:
- `unique (item_id, user_id)`

### `reviews`

- `id bigserial primary key`
- `item_id bigint not null references library_items(id)`
- `user_id bigint not null references users(id)`
- `body text not null`
- `status text not null default 'published' check (status in ('published','hidden','flagged'))`

Constraint:
- `check (char_length(body) between 1 and 1000)`

### `tags`

- `id bigserial primary key`
- `name text not null`
- `normalized_name text not null unique`
- `is_active boolean not null default true`
- `merged_into_tag_id bigint null references tags(id)`

### `item_tags`

- `item_id bigint not null references library_items(id)`
- `tag_id bigint not null references tags(id)`
- `added_by bigint null references users(id)`
- `approved_by bigint null references users(id)`
- `approved_at timestamptz null`
- `primary key (item_id, tag_id)`

### `tag_submissions`

- `id bigserial primary key`
- `item_id bigint not null references library_items(id)`
- `submitted_by bigint not null references users(id)`
- `raw_tag text not null`
- `status text not null default 'pending' check (status in ('pending','approved','rejected','merged'))`
- `resolved_tag_id bigint null references tags(id)`
- `reviewed_by bigint null references users(id)`
- `reviewed_at timestamptz null`

### `user_reading_status`

- `user_id bigint not null references users(id)`
- `item_id bigint not null references library_items(id)`
- `status text not null check (status in ('have','borrowed','want_to_read','recommended'))`
- `updated_at timestamptz not null default now()`
- `updated_by bigint null references users(id)`
- `primary key (user_id, item_id)`

## 5) Lending Tables

### `borrow_transactions`

- `id bigserial primary key`
- `public_id uuid not null unique`
- `item_id bigint not null references library_items(id)`
- `borrower_id bigint not null references users(id)`
- `state text not null check (state in ('checked_out','returned','overdue','lost','replacement_paid'))`
- `checked_out_at timestamptz not null`
- `due_at timestamptz not null`
- `checked_in_at timestamptz null`
- `suggested_donation_cents int null check (suggested_donation_cents >= 0)`
- `replacement_value_snapshot_cents int null check (replacement_value_snapshot_cents >= 0)`
- `lost_marked_at timestamptz null`
- `lost_marked_by bigint null references users(id)`
- `replacement_charge_status text null check (replacement_charge_status in ('pending_admin_confirmation','pending_payment','paid','waived','failed'))`
- `stripe_payment_intent_id text null`
- `admin_note text null`

Lifecycle rules:
- `due_at` is always `checked_out_at + interval '28 days'` at creation.
- only one active transaction per item: partial unique index
```sql
create unique index ux_borrow_transactions_one_active_per_item
  on borrow_transactions (item_id)
  where state in ('checked_out','overdue','lost') and deleted_at is null;
```

### `donations`

- `id bigserial primary key`
- `borrow_transaction_id bigint null references borrow_transactions(id)`
- `user_id bigint not null references users(id)`
- `amount_cents int not null check (amount_cents >= 0)`
- `currency text not null default 'usd'`
- `status text not null check (status in ('pending','succeeded','failed','refunded'))`
- `stripe_payment_intent_id text null`
- `stripe_charge_id text null`

## 6) Derived + Ops Tables

### `library_item_stats`

- `item_id bigint primary key references library_items(id)`
- `avg_rating numeric(3,2) not null default 0`
- `rating_count int not null default 0`
- `review_count int not null default 0`
- `borrow_count int not null default 0`
- `last_borrowed_at timestamptz null`
- `last_reviewed_at timestamptz null`
- `updated_at timestamptz not null default now()`

Used for high-speed sorting and discovery rails.

### `audit_log`

- `id bigserial primary key`
- `actor_user_id bigint null references users(id)`
- `action text not null`
- `entity_type text not null`
- `entity_id text not null`
- `request_id text null`
- `before_json jsonb null`
- `after_json jsonb null`
- `created_at timestamptz not null default now()`

## 7) Index Strategy

Recommended indexes:
- `library_items(media_type_id, deleted_at)`
- `library_items(studio_relevance_category_id, deleted_at)`
- `library_items(current_lending_status, deleted_at)`
- `library_items(staff_pick, date_added desc)`
- `ratings(item_id)`
- `reviews(item_id, status, created_at desc)`
- `borrow_transactions(borrower_id, state, checked_out_at desc)`
- `borrow_transactions(item_id, state, due_at)`
- `tag_submissions(status, reviewed_at nulls first)`

Search indexes:
- `gin(to_tsvector('english', title || ' ' || author || ' ' || coalesce(description,'')))`
- trigram on `title`, `author`, and `isbn_normalized`

## 8) Relationship Summary

- One `library_item` has many `ratings`, `reviews`, `item_tags`, and `borrow_transactions`.
- One `user` has many `ratings`, `reviews`, `borrow_transactions`, and `user_reading_status` rows.
- `tags` and `library_items` are many-to-many through `item_tags`.
- `tag_submissions` feed moderation and merge into `tags`.
- `donations` can be linked to borrow transactions.

## 9) Extensibility Hooks

Future additions without core-table rewrites:
- `reading_circles`, `reading_circle_members`, `reading_circle_sessions`
- `curated_lists`, `curated_list_items`
- `recommendation_edges` for personalized ranking
- `item_copies` for per-copy barcodes and condition tracking

## 10) Generated Migration Stubs (2026-03-01)

- `studio-brain/migrations/006_library_core.sql`
- `studio-brain/migrations/007_library_community.sql`
- `studio-brain/migrations/008_library_lending_and_ops.sql`
