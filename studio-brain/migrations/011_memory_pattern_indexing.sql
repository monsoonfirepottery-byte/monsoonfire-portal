CREATE TABLE IF NOT EXISTS memory_pattern_index (
  tenant_scope text NOT NULL DEFAULT '',
  memory_id text NOT NULL,
  pattern_type text NOT NULL,
  pattern_key text NOT NULL,
  pattern_value text NOT NULL,
  confidence real NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_scope, memory_id, pattern_type, pattern_key)
);

CREATE INDEX IF NOT EXISTS idx_memory_pattern_lookup
  ON memory_pattern_index (tenant_scope, pattern_type, pattern_key, confidence DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_pattern_memory
  ON memory_pattern_index (tenant_scope, memory_id, updated_at DESC);
