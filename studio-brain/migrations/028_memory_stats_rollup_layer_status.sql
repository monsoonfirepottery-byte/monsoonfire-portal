ALTER TABLE swarm_memory
  ADD COLUMN IF NOT EXISTS memory_layer text;

UPDATE swarm_memory
   SET memory_layer = COALESCE(
     NULLIF(LOWER(metadata->>'memoryLayer'), ''),
     CASE
       WHEN LOWER(memory_type) = 'working' THEN 'working'
       WHEN LOWER(memory_type) = 'episodic' THEN 'episodic'
       WHEN LOWER(memory_type) IN ('semantic', 'procedural') THEN 'canonical'
       ELSE 'episodic'
     END
   )
 WHERE memory_layer IS NULL OR memory_layer = '';

ALTER TABLE swarm_memory
  ALTER COLUMN memory_layer SET DEFAULT 'episodic';

ALTER TABLE memory_stats_rollup
  ADD COLUMN IF NOT EXISTS by_layer jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS by_status jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_swarm_memory_tenant_memory_layer
  ON swarm_memory (tenant_id, memory_layer);

CREATE INDEX IF NOT EXISTS idx_swarm_memory_tenant_status
  ON swarm_memory (tenant_id, status);
