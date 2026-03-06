CREATE TABLE IF NOT EXISTS memory_loop_feedback_event (
  event_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  loop_key text NOT NULL,
  action text NOT NULL,
  actor_id text,
  incident_id text,
  memory_id text,
  note text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'memory_loop_feedback_event_action_check'
  ) THEN
    ALTER TABLE memory_loop_feedback_event
      ADD CONSTRAINT memory_loop_feedback_event_action_check
      CHECK (action IN ('ack', 'assign', 'snooze', 'resolve', 'false-positive', 'escalate'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_memory_loop_feedback_event_loop_time
  ON memory_loop_feedback_event (tenant_scope, loop_key, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_loop_feedback_event_action_time
  ON memory_loop_feedback_event (tenant_scope, action, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_loop_feedback_event_incident
  ON memory_loop_feedback_event (tenant_scope, incident_id, occurred_at DESC);
