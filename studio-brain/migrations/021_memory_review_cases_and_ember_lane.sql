CREATE TABLE IF NOT EXISTS memory_review_case (
  id text PRIMARY KEY,
  tenant_id text NULL,
  case_type text NOT NULL CHECK (case_type IN ('resolve-conflict', 'revalidate', 'retire', 'promote-guidance')),
  status text NOT NULL CHECK (status IN ('open', 'in-progress', 'resolved', 'dismissed')),
  scope text NULL,
  primary_memory_id text NULL REFERENCES swarm_memory(memory_id) ON DELETE SET NULL,
  linked_memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  priority real NOT NULL DEFAULT 0.5,
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner text NULL,
  resolution text NULL,
  last_verification_run_id text NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_memory_review_case_status_priority
  ON memory_review_case (tenant_id, status, priority DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_review_case_scope
  ON memory_review_case (tenant_id, scope, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_review_case_case_type
  ON memory_review_case (tenant_id, case_type, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_verification_run (
  id text PRIMARY KEY,
  tenant_id text NULL,
  case_id text NULL REFERENCES memory_review_case(id) ON DELETE SET NULL,
  target_memory_id text NULL REFERENCES swarm_memory(memory_id) ON DELETE SET NULL,
  verifier_kind text NOT NULL CHECK (verifier_kind IN ('repo-head', 'runtime-check', 'startup-instruction', 'support-policy', 'support-outcome', 'operator-attested')),
  trigger text NOT NULL CHECK (trigger IN ('capture-conflict', 'operational-read', 'safety-read', 'review-action', 'startup-pack-change', 'repo-diff', 'support-case-resolved', 'weekly-maintenance', 'manual')),
  request_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_status text NOT NULL CHECK (result_status IN ('passed', 'failed', 'needs-review', 'skipped')),
  result_summary text NULL,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_memory_verification_run_case
  ON memory_verification_run (tenant_id, case_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_verification_run_target
  ON memory_verification_run (tenant_id, target_memory_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_verification_run_finished
  ON memory_verification_run (tenant_id, result_status, finished_at DESC);

ALTER TABLE brain_support_cases
  ADD COLUMN IF NOT EXISTS ember_memory_scope text NULL,
  ADD COLUMN IF NOT EXISTS ember_summary text NULL,
  ADD COLUMN IF NOT EXISTS confusion_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS confusion_reason text NULL,
  ADD COLUMN IF NOT EXISTS human_handoff boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_brain_support_cases_ember_scope
  ON brain_support_cases (ember_memory_scope, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_support_cases_confusion_state
  ON brain_support_cases (confusion_state, last_received_at DESC);
