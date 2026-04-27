CREATE INDEX IF NOT EXISTS idx_swarm_memory_stats_source_expr
  ON swarm_memory ((COALESCE(metadata->>'source', 'manual')));

CREATE INDEX IF NOT EXISTS idx_swarm_memory_stats_layer_expr
  ON swarm_memory ((
    COALESCE(
      NULLIF(LOWER(metadata->>'memoryLayer'), ''),
      CASE
        WHEN LOWER(memory_type) = 'working' THEN 'working'
        WHEN LOWER(memory_type) = 'episodic' THEN 'episodic'
        WHEN LOWER(memory_type) IN ('semantic', 'procedural') THEN 'canonical'
        ELSE 'episodic'
      END
    )
  ));

CREATE INDEX IF NOT EXISTS idx_swarm_memory_stats_status
  ON swarm_memory (status);
