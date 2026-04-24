CREATE TABLE IF NOT EXISTS brain_ops_ingest_receipts (
  id text PRIMARY KEY,
  source_system text NOT NULL,
  source_event_id text NOT NULL,
  payload_hash text NOT NULL,
  auth_principal text NOT NULL,
  received_at timestamptz NOT NULL,
  timestamp_skew_seconds integer NOT NULL DEFAULT 0,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_ops_ingest_receipts_source_event
  ON brain_ops_ingest_receipts (source_system, source_event_id);
CREATE INDEX IF NOT EXISTS idx_brain_ops_ingest_receipts_received
  ON brain_ops_ingest_receipts (received_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  entity_kind text NOT NULL,
  entity_id text NOT NULL,
  case_id text NULL,
  source_system text NOT NULL,
  source_event_id text NOT NULL,
  dedupe_key text NOT NULL,
  room_id text NULL,
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  confidence real NOT NULL DEFAULT 0.5,
  occurred_at timestamptz NOT NULL,
  ingested_at timestamptz NOT NULL,
  verification_class text NOT NULL CHECK (verification_class IN ('observed', 'inferred', 'planned', 'claimed', 'confirmed')),
  artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_ops_events_source_event
  ON brain_ops_events (source_system, source_event_id);
CREATE INDEX IF NOT EXISTS idx_brain_ops_events_case
  ON brain_ops_events (case_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_ops_events_entity
  ON brain_ops_events (entity_kind, entity_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_auth_receipts (
  id text PRIMARY KEY,
  source_system text NOT NULL,
  actor_id text NOT NULL,
  actor_kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('authorized', 'denied', 'degraded')),
  observed_at timestamptz NOT NULL,
  expires_at timestamptz NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_auth_receipts_observed
  ON brain_ops_auth_receipts (observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_ops_auth_receipts_actor
  ON brain_ops_auth_receipts (actor_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_cases (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('kiln_run', 'arrival', 'support_thread', 'event', 'anomaly', 'complaint', 'growth_experiment', 'improvement_case', 'station_session', 'general')),
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('open', 'active', 'blocked', 'awaiting_approval', 'resolved', 'canceled')),
  priority text NOT NULL CHECK (priority IN ('p0', 'p1', 'p2', 'p3')),
  lane text NOT NULL CHECK (lane IN ('owner', 'manager', 'hands', 'internet', 'ceo', 'forge')),
  owner_role text NULL,
  verification_class text NOT NULL CHECK (verification_class IN ('observed', 'inferred', 'planned', 'claimed', 'confirmed')),
  freshest_at timestamptz NULL,
  confidence real NOT NULL DEFAULT 0.5,
  degrade_reason text NULL,
  due_at timestamptz NULL,
  linked_entity_kind text NULL,
  linked_entity_id text NULL,
  memory_scope text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_cases_status
  ON brain_ops_cases (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_ops_cases_lane
  ON brain_ops_cases (lane, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_ops_cases_priority
  ON brain_ops_cases (priority, updated_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_case_notes (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES brain_ops_cases(id) ON DELETE CASCADE,
  actor_id text NOT NULL,
  actor_kind text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_case_notes_case_created
  ON brain_ops_case_notes (case_id, created_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_tasks (
  id text PRIMARY KEY,
  case_id text NULL REFERENCES brain_ops_cases(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('proposed', 'queued', 'claimed', 'in_progress', 'blocked', 'proof_pending', 'verified', 'reopened', 'canceled')),
  priority text NOT NULL CHECK (priority IN ('p0', 'p1', 'p2', 'p3')),
  surface text NOT NULL CHECK (surface IN ('hands', 'internet', 'manager', 'owner')),
  role text NOT NULL,
  zone text NOT NULL,
  due_at timestamptz NULL,
  eta_minutes integer NULL,
  interruptibility text NOT NULL CHECK (interruptibility IN ('now', 'soon', 'queue')),
  verification_class text NOT NULL CHECK (verification_class IN ('observed', 'inferred', 'planned', 'claimed', 'confirmed')),
  freshest_at timestamptz NULL,
  confidence real NOT NULL DEFAULT 0.5,
  degrade_reason text NULL,
  claimed_by text NULL,
  claimed_at timestamptz NULL,
  completed_at timestamptz NULL,
  blocker_reason text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_tasks_status
  ON brain_ops_tasks (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_ops_tasks_case
  ON brain_ops_tasks (case_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_ops_tasks_surface_zone
  ON brain_ops_tasks (surface, zone, updated_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_task_proofs (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES brain_ops_tasks(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('manual_confirm', 'qr_scan', 'camera_snapshot', 'sensor_transition', 'dual_confirm')),
  actor_id text NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('submitted', 'accepted', 'rejected')),
  note text NULL,
  artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_task_proofs_task_created
  ON brain_ops_task_proofs (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_approvals (
  id text PRIMARY KEY,
  case_id text NULL REFERENCES brain_ops_cases(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'executed', 'expired')),
  action_class text NOT NULL,
  requested_by text NOT NULL,
  required_role text NOT NULL,
  verification_class text NOT NULL CHECK (verification_class IN ('observed', 'inferred', 'planned', 'claimed', 'confirmed')),
  freshest_at timestamptz NULL,
  confidence real NOT NULL DEFAULT 0.5,
  degrade_reason text NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  resolved_at timestamptz NULL,
  resolved_by text NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_approvals_status
  ON brain_ops_approvals (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_ops_approvals_case
  ON brain_ops_approvals (case_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_action_effect_receipts (
  id text PRIMARY KEY,
  action_id text NOT NULL,
  source_system text NOT NULL,
  effect_type text NOT NULL,
  verification_class text NOT NULL CHECK (verification_class IN ('observed', 'inferred', 'planned', 'claimed', 'confirmed')),
  observed_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_action_effect_receipts_action
  ON brain_ops_action_effect_receipts (action_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_growth_experiments (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('proposed', 'running', 'paused', 'completed')),
  owner text NOT NULL,
  updated_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_growth_experiments_status
  ON brain_ops_growth_experiments (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_improvement_cases (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('open', 'evaluating', 'approved', 'shadow', 'rejected', 'shipped')),
  updated_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_improvement_cases_status
  ON brain_ops_improvement_cases (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_station_sessions (
  id text PRIMARY KEY,
  station_id text NOT NULL,
  room_id text NOT NULL,
  surface_mode text NOT NULL CHECK (surface_mode IN ('ambient_board', 'focus_task', 'proof_station')),
  current_task_id text NULL REFERENCES brain_ops_tasks(id) ON DELETE SET NULL,
  actor_id text NULL,
  last_seen_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_ops_station_sessions_station
  ON brain_ops_station_sessions (station_id);
CREATE INDEX IF NOT EXISTS idx_brain_ops_station_sessions_last_seen
  ON brain_ops_station_sessions (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_degraded_modes (
  mode text PRIMARY KEY CHECK (mode IN ('observe_only', 'draft_only', 'no_human_tasking', 'manual_dispatch_only', 'internet_pause', 'growth_pause', 'forge_pause')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS brain_ops_source_freshness (
  source_key text PRIMARY KEY,
  freshest_at timestamptz NULL,
  freshness_seconds integer NULL,
  budget_seconds integer NOT NULL,
  status text NOT NULL CHECK (status IN ('healthy', 'warning', 'critical')),
  reason text NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS brain_ops_watchdogs (
  id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('healthy', 'warning', 'critical')),
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb
);
