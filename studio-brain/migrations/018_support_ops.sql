CREATE TABLE IF NOT EXISTS brain_support_mailbox_state (
  provider text NOT NULL,
  mailbox text NOT NULL,
  history_cursor text NULL,
  last_sync_at timestamptz NULL,
  last_success_at timestamptz NULL,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  backoff_until timestamptz NULL,
  last_error text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (provider, mailbox)
);

CREATE TABLE IF NOT EXISTS brain_support_mailbox_messages (
  provider text NOT NULL,
  mailbox text NOT NULL,
  provider_message_id text NOT NULL,
  provider_thread_id text NOT NULL,
  support_request_id text NULL,
  received_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('received', 'processed', 'dead_letter')),
  decision text NULL,
  risk_state text NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_message_id)
);

CREATE INDEX IF NOT EXISTS idx_brain_support_mailbox_messages_thread
  ON brain_support_mailbox_messages (provider, provider_thread_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_support_mailbox_messages_status
  ON brain_support_mailbox_messages (status, received_at DESC);

CREATE TABLE IF NOT EXISTS brain_support_cases (
  support_request_id text PRIMARY KEY,
  source_provider text NOT NULL,
  mailbox text NOT NULL,
  source_thread_id text NOT NULL,
  source_message_id text NULL,
  latest_source_message_id text NULL,
  sender_email text NULL,
  sender_verified_uid text NULL,
  policy_slug text NULL,
  policy_version text NULL,
  decision text NOT NULL,
  risk_state text NOT NULL,
  automation_state text NOT NULL,
  queue_bucket text NOT NULL,
  unread boolean NOT NULL DEFAULT true,
  reply_draft text NULL,
  proposal_id text NULL,
  proposal_capability_id text NULL,
  last_received_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  raw_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_support_cases_queue
  ON brain_support_cases (queue_bucket, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_support_cases_unread
  ON brain_support_cases (unread, last_received_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_support_cases_thread
  ON brain_support_cases (source_provider, source_thread_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS brain_support_dead_letters (
  id text PRIMARY KEY,
  provider text NOT NULL,
  mailbox text NOT NULL,
  provider_message_id text NULL,
  error_message text NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_support_dead_letters_created_at
  ON brain_support_dead_letters (created_at DESC);
