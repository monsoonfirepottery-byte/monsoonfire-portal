CREATE INDEX IF NOT EXISTS idx_studio_state_daily_generated_at ON studio_state_daily (generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_studio_state_diff_to_snapshot_date ON studio_state_diff (to_snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_brain_job_runs_status_started_at ON brain_job_runs (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_job_runs_completed_at ON brain_job_runs (completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_event_log_action_at ON brain_event_log (action, at DESC);
