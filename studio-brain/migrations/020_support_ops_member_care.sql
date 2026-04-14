ALTER TABLE brain_support_cases
  ADD COLUMN IF NOT EXISTS conversation_key text NULL,
  ADD COLUMN IF NOT EXISTS thread_drift_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS member_care_state text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS member_care_reason text NULL,
  ADD COLUMN IF NOT EXISTS last_care_touch_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS care_touch_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_operator_action_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS next_recommended_action text NULL,
  ADD COLUMN IF NOT EXISTS support_summary text NULL;

UPDATE brain_support_cases
SET conversation_key = COALESCE(conversation_key, source_thread_id)
WHERE conversation_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_brain_support_cases_conversation
  ON brain_support_cases (source_provider, conversation_key, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_support_cases_thread_drift
  ON brain_support_cases (thread_drift_flag, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_brain_support_cases_member_care
  ON brain_support_cases (member_care_state, last_received_at DESC);
