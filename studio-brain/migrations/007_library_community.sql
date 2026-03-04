CREATE TABLE IF NOT EXISTS ratings (
  id bigserial PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES library_items(id),
  user_id bigint NOT NULL REFERENCES users(id),
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id),
  UNIQUE (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS reviews (
  id bigserial PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES library_items(id),
  user_id bigint NOT NULL REFERENCES users(id),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('published', 'hidden', 'flagged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS tags (
  id bigserial PRIMARY KEY,
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  merged_into_tag_id bigint NULL REFERENCES tags(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS item_tags (
  item_id bigint NOT NULL REFERENCES library_items(id),
  tag_id bigint NOT NULL REFERENCES tags(id),
  added_by bigint NULL REFERENCES users(id),
  approved_by bigint NULL REFERENCES users(id),
  approved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id),
  PRIMARY KEY (item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS tag_submissions (
  id bigserial PRIMARY KEY,
  item_id bigint NOT NULL REFERENCES library_items(id),
  submitted_by bigint NOT NULL REFERENCES users(id),
  raw_tag text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'merged')),
  resolved_tag_id bigint NULL REFERENCES tags(id),
  reviewed_by bigint NULL REFERENCES users(id),
  reviewed_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_reading_status (
  user_id bigint NOT NULL REFERENCES users(id),
  item_id bigint NOT NULL REFERENCES library_items(id),
  status text NOT NULL CHECK (status IN ('have', 'borrowed', 'want_to_read', 'recommended')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by bigint NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by bigint NULL REFERENCES users(id),
  deleted_at timestamptz NULL,
  deleted_by bigint NULL REFERENCES users(id),
  PRIMARY KEY (user_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_ratings_item_id
  ON ratings (item_id);
CREATE INDEX IF NOT EXISTS idx_reviews_item_status_created_at
  ON reviews (item_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tag_submissions_status_reviewed_at
  ON tag_submissions (status, reviewed_at NULLS FIRST);
