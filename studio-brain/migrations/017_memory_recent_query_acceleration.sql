-- Accelerate retrieval fallback paths that rank by "freshness" with COALESCE(occurred_at, created_at).
-- These paths are hit heavily during ingest pressure and timeout fallbacks.

CREATE INDEX IF NOT EXISTS idx_swarm_memory_recent_active_tenant_coalesced
  ON swarm_memory (tenant_id, COALESCE(occurred_at, created_at) DESC, created_at DESC)
  WHERE status <> 'quarantined';

CREATE INDEX IF NOT EXISTS idx_swarm_memory_recent_active_tenant_agent_run_coalesced
  ON swarm_memory (tenant_id, agent_id, run_id, COALESCE(occurred_at, created_at) DESC, created_at DESC)
  WHERE status <> 'quarantined';

CREATE INDEX IF NOT EXISTS idx_swarm_memory_recent_active_tenant_source_coalesced
  ON swarm_memory (
    tenant_id,
    (COALESCE(metadata->>'source', 'manual')),
    COALESCE(occurred_at, created_at) DESC,
    created_at DESC
  )
  WHERE status <> 'quarantined';
