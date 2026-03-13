CREATE TABLE IF NOT EXISTS memory_relation_edge (
  tenant_scope text NOT NULL DEFAULT '',
  source_memory_id text NOT NULL,
  target_memory_id text NOT NULL,
  relation_type text NOT NULL,
  weight real NOT NULL DEFAULT 0.5,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_scope, source_memory_id, target_memory_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_memory_relation_edge_target
  ON memory_relation_edge (tenant_scope, target_memory_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_relation_edge_type_weight
  ON memory_relation_edge (tenant_scope, relation_type, weight DESC, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_entity_index (
  tenant_scope text NOT NULL DEFAULT '',
  memory_id text NOT NULL,
  entity_type text NOT NULL,
  entity_key text NOT NULL,
  entity_value text NOT NULL,
  confidence real NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_scope, memory_id, entity_type, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_memory_entity_lookup
  ON memory_entity_index (tenant_scope, entity_type, entity_key, confidence DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_entity_memory
  ON memory_entity_index (tenant_scope, memory_id, updated_at DESC);
