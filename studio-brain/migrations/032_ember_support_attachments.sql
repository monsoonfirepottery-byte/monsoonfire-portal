CREATE TABLE IF NOT EXISTS brain_ember_support_attachments (
  id text PRIMARY KEY,
  session_id text NOT NULL CHECK (session_id ~ '^[A-Za-z0-9_-]{1,120}$'),
  support_request_id text NULL CHECK (support_request_id IS NULL OR char_length(support_request_id) <= 160),
  page_path text NOT NULL CHECK (char_length(page_path) BETWEEN 1 AND 240),
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 140),
  content_type text NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 524288),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  payload bytea NOT NULL CHECK (octet_length(payload) > 0 AND octet_length(payload) <= 524288),
  note text NULL CHECK (note IS NULL OR char_length(note) <= 300),
  source text NOT NULL DEFAULT 'ember-web-chat' CHECK (char_length(source) BETWEEN 1 AND 80),
  uploaded_by text NOT NULL DEFAULT 'firebase-apiV1' CHECK (char_length(uploaded_by) BETWEEN 1 AND 80),
  request_id text NULL CHECK (request_id IS NULL OR char_length(request_id) <= 160),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  deleted_at timestamptz NULL,
  CHECK (expires_at <= created_at + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_brain_ember_support_attachments_expiry
  ON brain_ember_support_attachments (expires_at)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_brain_ember_support_attachments_session
  ON brain_ember_support_attachments (session_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_brain_ember_support_attachments_request
  ON brain_ember_support_attachments (support_request_id, created_at DESC)
  WHERE support_request_id IS NOT NULL AND deleted_at IS NULL;
