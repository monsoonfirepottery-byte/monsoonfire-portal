CREATE TABLE IF NOT EXISTS memory_loop_transition_event (
  event_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  loop_key text NOT NULL,
  from_state text NULL,
  to_state text NOT NULL,
  confidence real NOT NULL DEFAULT 0.5,
  memory_id text NULL,
  occurred_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'memory_loop_transition_to_state_check'
  ) THEN
    ALTER TABLE memory_loop_transition_event
      ADD CONSTRAINT memory_loop_transition_to_state_check
      CHECK (to_state IN ('open-loop', 'resolved', 'reopened', 'superseded'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_memory_loop_transition_scope_time
  ON memory_loop_transition_event (tenant_scope, loop_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_loop_transition_state_time
  ON memory_loop_transition_event (tenant_scope, to_state, created_at DESC);
