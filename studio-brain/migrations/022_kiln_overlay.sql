CREATE TABLE IF NOT EXISTS brain_kilns (
  id text PRIMARY KEY,
  display_name text NOT NULL,
  manufacturer text NOT NULL,
  kiln_model text NOT NULL,
  controller_model text NOT NULL,
  controller_family text NOT NULL,
  firmware_version text NULL,
  serial_number text NULL,
  mac_address text NULL,
  zone_count int NOT NULL DEFAULT 1,
  thermocouple_type text NULL,
  output4_role text NULL,
  wifi_configured boolean NOT NULL DEFAULT false,
  last_seen_at timestamptz NULL,
  current_run_id text NULL,
  raw_payload jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_kilns_display_name ON brain_kilns (display_name);
CREATE INDEX IF NOT EXISTS idx_brain_kilns_last_seen_at ON brain_kilns (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_kilns_current_run_id ON brain_kilns (current_run_id);

CREATE TABLE IF NOT EXISTS brain_kiln_capability_documents (
  id text PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES brain_kilns(id) ON DELETE CASCADE,
  fingerprint_hash text NOT NULL,
  generated_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_kiln_capability_documents_kiln_id_generated_at
  ON brain_kiln_capability_documents (kiln_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_kiln_capability_documents_fingerprint_hash
  ON brain_kiln_capability_documents (fingerprint_hash);

CREATE TABLE IF NOT EXISTS brain_kiln_import_runs (
  id text PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES brain_kilns(id) ON DELETE CASCADE,
  source text NOT NULL,
  parser_kind text NOT NULL,
  parser_version text NOT NULL,
  status text NOT NULL,
  observed_at timestamptz NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  artifact_id text NULL,
  diagnostics jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_kiln_import_runs_kiln_id_started_at
  ON brain_kiln_import_runs (kiln_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_kiln_import_runs_status
  ON brain_kiln_import_runs (status, started_at DESC);

CREATE TABLE IF NOT EXISTS brain_kiln_firing_runs (
  id text PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES brain_kilns(id) ON DELETE CASCADE,
  run_source text NOT NULL,
  status text NOT NULL,
  queue_state text NOT NULL,
  control_posture text NOT NULL,
  program_name text NULL,
  program_type text NULL,
  cone_target text NULL,
  speed text NULL,
  start_time timestamptz NULL,
  end_time timestamptz NULL,
  duration_sec int NULL,
  current_segment int NULL,
  total_segments int NULL,
  max_temp double precision NULL,
  final_set_point double precision NULL,
  operator_id text NULL,
  operator_confirmation_at timestamptz NULL,
  firmware_version text NULL,
  raw_payload jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_kiln_firing_runs_kiln_id_start_time
  ON brain_kiln_firing_runs (kiln_id, start_time DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_brain_kiln_firing_runs_status
  ON brain_kiln_firing_runs (status, start_time DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_brain_kiln_firing_runs_queue_state
  ON brain_kiln_firing_runs (queue_state, start_time DESC NULLS LAST);

ALTER TABLE brain_kilns
  ADD CONSTRAINT fk_brain_kilns_current_run
  FOREIGN KEY (current_run_id) REFERENCES brain_kiln_firing_runs(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS brain_kiln_artifacts (
  id text PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES brain_kilns(id) ON DELETE CASCADE,
  firing_run_id text NULL REFERENCES brain_kiln_firing_runs(id) ON DELETE SET NULL,
  import_run_id text NULL REFERENCES brain_kiln_import_runs(id) ON DELETE SET NULL,
  artifact_kind text NOT NULL,
  source_label text NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL,
  observed_at timestamptz NULL,
  raw_payload jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_brain_kiln_artifacts_sha256_storage_key
  ON brain_kiln_artifacts (sha256, storage_key);
CREATE INDEX IF NOT EXISTS idx_brain_kiln_artifacts_kiln_id_observed_at
  ON brain_kiln_artifacts (kiln_id, observed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_brain_kiln_artifacts_sha256
  ON brain_kiln_artifacts (sha256);

CREATE TABLE IF NOT EXISTS brain_kiln_firing_events (
  id text PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES brain_kilns(id) ON DELETE CASCADE,
  firing_run_id text NOT NULL REFERENCES brain_kiln_firing_runs(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  event_type text NOT NULL,
  severity text NOT NULL,
  source text NOT NULL,
  confidence text NOT NULL,
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_kiln_firing_events_run_ts
  ON brain_kiln_firing_events (firing_run_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_brain_kiln_firing_events_kiln_ts
  ON brain_kiln_firing_events (kiln_id, ts DESC);

CREATE TABLE IF NOT EXISTS brain_kiln_telemetry_points (
  id bigserial PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES brain_kilns(id) ON DELETE CASCADE,
  firing_run_id text NOT NULL REFERENCES brain_kiln_firing_runs(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  segment int NULL,
  set_point double precision NULL,
  temp_primary double precision NULL,
  temp_zone_1 double precision NULL,
  temp_zone_2 double precision NULL,
  temp_zone_3 double precision NULL,
  percent_power_1 double precision NULL,
  percent_power_2 double precision NULL,
  percent_power_3 double precision NULL,
  board_temp double precision NULL,
  raw_payload jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_kiln_telemetry_points_run_ts
  ON brain_kiln_telemetry_points (firing_run_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_brain_kiln_telemetry_points_kiln_ts
  ON brain_kiln_telemetry_points (kiln_id, ts DESC);

CREATE TABLE IF NOT EXISTS brain_kiln_health_snapshots (
  id text PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES brain_kilns(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  raw_payload jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_kiln_health_snapshots_kiln_ts
  ON brain_kiln_health_snapshots (kiln_id, ts DESC);

CREATE TABLE IF NOT EXISTS brain_kiln_operator_actions (
  id text PRIMARY KEY,
  kiln_id text NOT NULL REFERENCES brain_kilns(id) ON DELETE CASCADE,
  firing_run_id text NULL REFERENCES brain_kiln_firing_runs(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  requested_by text NOT NULL,
  confirmed_by text NULL,
  requested_at timestamptz NOT NULL,
  completed_at timestamptz NULL,
  checklist_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NULL,
  raw_payload jsonb NOT NULL,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_kiln_operator_actions_kiln_requested_at
  ON brain_kiln_operator_actions (kiln_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_kiln_operator_actions_run_requested_at
  ON brain_kiln_operator_actions (firing_run_id, requested_at DESC);
