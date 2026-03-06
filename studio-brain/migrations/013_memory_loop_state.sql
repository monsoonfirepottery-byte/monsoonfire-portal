CREATE TABLE IF NOT EXISTS memory_loop_state (
  tenant_scope text NOT NULL DEFAULT '',
  loop_key text NOT NULL,
  current_state text NOT NULL DEFAULT 'open-loop',
  last_state_confidence real NOT NULL DEFAULT 0.5,
  last_memory_id text NULL,
  last_open_memory_id text NULL,
  last_resolved_memory_id text NULL,
  open_events int NOT NULL DEFAULT 0,
  resolved_events int NOT NULL DEFAULT 0,
  reopened_events int NOT NULL DEFAULT 0,
  superseded_events int NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (tenant_scope, loop_key)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'memory_loop_state_current_state_check'
  ) THEN
    ALTER TABLE memory_loop_state
      ADD CONSTRAINT memory_loop_state_current_state_check
      CHECK (current_state IN ('open-loop', 'resolved', 'reopened', 'superseded'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_memory_loop_state_current
  ON memory_loop_state (tenant_scope, current_state, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_loop_state_last_memory
  ON memory_loop_state (tenant_scope, last_memory_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_relation_edge_supersedes
  ON memory_relation_edge (tenant_scope, relation_type, source_memory_id, target_memory_id, updated_at DESC)
  WHERE relation_type IN ('resolves', 'reopens', 'supersedes');
