CREATE TABLE IF NOT EXISTS memory_loop_action_idempotency (
  tenant_scope text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  PRIMARY KEY (tenant_scope, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_memory_loop_action_idempotency_expires
  ON memory_loop_action_idempotency (expires_at);

CREATE INDEX IF NOT EXISTS idx_memory_loop_action_idempotency_last_seen
  ON memory_loop_action_idempotency (tenant_scope, last_seen_at DESC);
