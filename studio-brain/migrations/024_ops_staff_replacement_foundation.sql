ALTER TABLE brain_ops_task_proofs
  DROP CONSTRAINT IF EXISTS brain_ops_task_proofs_verification_status_check;

ALTER TABLE brain_ops_task_proofs
  ADD CONSTRAINT brain_ops_task_proofs_verification_status_check
  CHECK (verification_status IN ('submitted', 'accepted', 'rejected', 'readback_pending'));

CREATE TABLE IF NOT EXISTS brain_ops_task_escapes (
  id text PRIMARY KEY,
  task_id text NOT NULL REFERENCES brain_ops_tasks(id) ON DELETE CASCADE,
  case_id text NULL REFERENCES brain_ops_cases(id) ON DELETE SET NULL,
  actor_id text NOT NULL,
  escape_hatch text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz NULL,
  resolved_by text NULL,
  raw_payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_task_escapes_task_created
  ON brain_ops_task_escapes (task_id, created_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_overrides (
  id text PRIMARY KEY,
  actor_id text NOT NULL,
  scope text NOT NULL,
  required_role text NOT NULL,
  status text NOT NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz NULL,
  resolved_by text NULL,
  raw_payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_overrides_created
  ON brain_ops_overrides (created_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_member_audits (
  id text PRIMARY KEY,
  uid text NOT NULL,
  kind text NOT NULL,
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_member_audits_uid_created
  ON brain_ops_member_audits (uid, created_at DESC);

CREATE TABLE IF NOT EXISTS brain_ops_reservation_bundles (
  id text PRIMARY KEY,
  reservation_id text NOT NULL UNIQUE,
  status text NOT NULL,
  due_at timestamptz NULL,
  owner_uid text NULL,
  updated_at timestamptz NOT NULL,
  raw_payload jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_brain_ops_reservation_bundles_due
  ON brain_ops_reservation_bundles (due_at ASC, updated_at DESC);
