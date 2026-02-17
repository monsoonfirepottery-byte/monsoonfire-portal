CREATE TABLE IF NOT EXISTS studio_state_daily (
  snapshot_date date PRIMARY KEY,
  schema_version text NOT NULL,
  generated_at timestamptz NOT NULL,
  firestore_read_at timestamptz NOT NULL,
  stripe_read_at timestamptz NULL,
  counts jsonb NOT NULL,
  ops jsonb NOT NULL,
  finance jsonb NOT NULL,
  source_hashes jsonb NOT NULL,
  raw_snapshot jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_state_diff (
  id bigserial PRIMARY KEY,
  from_snapshot_date date NOT NULL,
  to_snapshot_date date NOT NULL,
  changes jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brain_job_runs (
  id uuid PRIMARY KEY,
  job_name text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  summary text NULL,
  error_message text NULL
);

CREATE TABLE IF NOT EXISTS brain_event_log (
  id uuid PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  action text NOT NULL,
  rationale text NOT NULL,
  target text NOT NULL,
  approval_state text NOT NULL,
  input_hash text NOT NULL,
  output_hash text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_event_log_at ON brain_event_log (at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_event_log_action ON brain_event_log (action);
CREATE INDEX IF NOT EXISTS idx_brain_job_runs_job_name ON brain_job_runs (job_name, started_at DESC);
