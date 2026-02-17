CREATE TABLE IF NOT EXISTS brain_capability_proposals (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL,
  requested_by text NOT NULL,
  capability_id text NOT NULL,
  rationale text NOT NULL,
  input_hash text NOT NULL,
  preview jsonb NOT NULL,
  status text NOT NULL,
  approved_by text NULL,
  approved_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS idx_brain_capability_proposals_created_at
  ON brain_capability_proposals (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_capability_proposals_status
  ON brain_capability_proposals (status, created_at DESC);

CREATE TABLE IF NOT EXISTS brain_capability_quota (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0)
);
