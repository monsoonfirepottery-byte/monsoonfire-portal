CREATE INDEX IF NOT EXISTS idx_memory_relation_edge_resolves
  ON memory_relation_edge (tenant_scope, relation_type, source_memory_id, weight DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_relation_edge_target_relation
  ON memory_relation_edge (tenant_scope, target_memory_id, relation_type, weight DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_pattern_state
  ON memory_pattern_index (tenant_scope, pattern_type, pattern_key, confidence DESC, updated_at DESC)
  WHERE pattern_type IN ('state', 'loop-cluster', 'loop-state', 'priority', 'thread-depth');
