CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  auth_uid text NOT NULL UNIQUE,
  email text NULL,
  display_name text NULL,
  role text NOT NULL CHECK (role IN ('public', 'member', 'admin')),
  stripe_customer_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS media_types (
  id smallserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  lending_supported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

INSERT INTO media_types (code, label, lending_supported)
VALUES
  ('physical_book', 'Physical Book', true),
  ('digital_book', 'Digital Book', false),
  ('external_link', 'External Link', false),
  ('video_course', 'Video Course', false),
  ('studio_document', 'Studio Document', false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS studio_relevance_categories (
  id smallserial PRIMARY KEY,
  code text NOT NULL UNIQUE,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

INSERT INTO studio_relevance_categories (code, label)
VALUES
  ('ceramics_technique', 'Ceramics Technique'),
  ('glaze_chemistry', 'Glaze Chemistry'),
  ('kiln_theory', 'Kiln Theory'),
  ('studio_business', 'Studio Business'),
  ('creativity', 'Creativity'),
  ('philosophy', 'Philosophy'),
  ('mental_health', 'Mental Health'),
  ('design', 'Design'),
  ('fiction', 'Fiction')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS library_items (
  id bigserial PRIMARY KEY,
  public_id uuid NOT NULL UNIQUE,
  title text NOT NULL,
  author text NOT NULL,
  isbn10 text NULL,
  isbn13 text NULL,
  isbn_normalized text NULL,
  cover_image_url text NULL,
  description text NULL,
  publisher text NULL,
  publication_year integer NULL,
  page_count integer NULL,
  media_type_id smallint NOT NULL REFERENCES media_types(id),
  primary_genre text NULL,
  studio_relevance_category_id smallint NULL REFERENCES studio_relevance_categories(id),
  replacement_value_cents integer NULL CHECK (replacement_value_cents >= 0),
  lending_eligible boolean NOT NULL DEFAULT false,
  current_lending_status text NOT NULL DEFAULT 'available'
    CHECK (current_lending_status IN ('available', 'checked_out', 'overdue', 'lost')),
  staff_pick boolean NOT NULL DEFAULT false,
  added_by bigint NOT NULL REFERENCES users(id),
  date_added timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS item_assets (
  id bigserial PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES library_items(id),
  asset_type text NOT NULL CHECK (asset_type IN ('pdf', 'link', 'video', 'doc')),
  url text NOT NULL,
  title text NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_library_items_isbn_active
  ON library_items (isbn_normalized)
  WHERE isbn_normalized IS NOT NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_library_items_media_type_deleted_at
  ON library_items (media_type_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_library_items_relevance_deleted_at
  ON library_items (studio_relevance_category_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_library_items_lending_status_deleted_at
  ON library_items (current_lending_status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_library_items_staff_pick_date_added
  ON library_items (staff_pick, date_added DESC);

CREATE INDEX IF NOT EXISTS idx_library_items_search_tsv
  ON library_items
  USING gin (to_tsvector('english', title || ' ' || author || ' ' || coalesce(description, '')));
CREATE INDEX IF NOT EXISTS idx_library_items_title_trgm
  ON library_items USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_library_items_author_trgm
  ON library_items USING gin (author gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_library_items_isbn_normalized_trgm
  ON library_items USING gin (coalesce(isbn_normalized, '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_item_assets_item_position
  ON item_assets (item_id, position);
