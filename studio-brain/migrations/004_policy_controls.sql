CREATE TABLE IF NOT EXISTS brain_capability_exemption_events (
  id bigserial PRIMARY KEY,
  exemption_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('created', 'revoked')),
  capability_id text NULL,
  owner_uid text NULL,
  justification text NOT NULL,
  actor_id text NOT NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_capability_exemption_events_exemption_id
  ON brain_capability_exemption_events (exemption_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_capability_exemption_events_created_at
  ON brain_capability_exemption_events (created_at DESC);

CREATE TABLE IF NOT EXISTS brain_capability_kill_switch_events (
  id bigserial PRIMARY KEY,
  enabled boolean NOT NULL,
  changed_by text NOT NULL,
  rationale text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brain_capability_kill_switch_events_created_at
  ON brain_capability_kill_switch_events (created_at DESC);
