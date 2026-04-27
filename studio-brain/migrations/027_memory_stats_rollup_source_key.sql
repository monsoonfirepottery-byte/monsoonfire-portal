ALTER TABLE swarm_memory
  ADD COLUMN IF NOT EXISTS source_key text,
  ADD COLUMN IF NOT EXISTS source_family text,
  ADD COLUMN IF NOT EXISTS memory_class text,
  ADD COLUMN IF NOT EXISTS quality_tier text,
  ADD COLUMN IF NOT EXISTS subject_key text,
  ADD COLUMN IF NOT EXISTS workstream_key text;

UPDATE swarm_memory
   SET source_key = LEFT(COALESCE(NULLIF(metadata->>'source', ''), 'manual'), 160)
 WHERE source_key IS NULL OR source_key = '';

UPDATE swarm_memory
   SET source_family = CASE
     WHEN LOWER(source_key) ~ '^(mail|email|gmail|outlook)(:|$)' THEN 'mail'
     WHEN LOWER(source_key) ~ '^(repo-markdown|doc|docs|document|pst|import|context-slice|chatgpt-export)(:|$)' THEN 'doc'
     WHEN LOWER(source_key) ~ '^(social|twitter|web)(:|$)' THEN 'web'
     WHEN LOWER(source_key) ~ '^(automation|digest|scheduled)(:|$)' THEN 'automation'
     ELSE 'ops'
   END
 WHERE source_family IS NULL OR source_family = '';

UPDATE swarm_memory
   SET memory_class = CASE
     WHEN LOWER(memory_type) = 'working' THEN 'task_working'
     WHEN LOWER(COALESCE(metadata->>'memoryCategory', metadata->>'category', '')) IN ('fact', 'guardrail', 'preference', 'procedure')
       THEN LOWER(COALESCE(metadata->>'memoryCategory', metadata->>'category'))
     WHEN LOWER(source_key) LIKE '%connection%' OR LOWER(source_key) LIKE '%relation%' THEN 'relationship'
     WHEN LOWER(source_key) LIKE '%telemetry%' OR LOWER(source_key) LIKE '%stats%' OR LOWER(source_key) LIKE '%health%' THEN 'telemetry'
     WHEN source_family = 'mail' OR LOWER(source_key) LIKE 'replay:%' THEN 'coordination'
     ELSE 'artifact'
   END
 WHERE memory_class IS NULL OR memory_class = '';

UPDATE swarm_memory
   SET quality_tier = CASE
     WHEN LOWER(source_key) LIKE '%promoted%' OR LOWER(memory_type) IN ('semantic', 'procedural') OR (status = 'accepted' AND importance >= 0.85) THEN 'promoted'
     WHEN status = 'quarantined' THEN 'quarantined'
     WHEN status = 'archived' THEN 'archived'
     ELSE 'raw'
   END
 WHERE quality_tier IS NULL OR quality_tier = '';

UPDATE swarm_memory
   SET subject_key = LOWER(LEFT(REGEXP_REPLACE(COALESCE(metadata->>'subjectKey', metadata->>'subject', metadata->>'scope', ''), '\s+', '-', 'g'), 160))
 WHERE (subject_key IS NULL OR subject_key = '')
   AND COALESCE(metadata->>'subjectKey', metadata->>'subject', metadata->>'scope', '') <> '';

UPDATE swarm_memory
   SET workstream_key = LOWER(LEFT(REGEXP_REPLACE(COALESCE(metadata->>'workstreamKey', metadata->>'projectLane', metadata->>'lane', ''), '\s+', '-', 'g'), 160))
 WHERE (workstream_key IS NULL OR workstream_key = '')
   AND COALESCE(metadata->>'workstreamKey', metadata->>'projectLane', metadata->>'lane', '') <> '';

ALTER TABLE swarm_memory
  ALTER COLUMN source_key SET DEFAULT 'manual',
  ALTER COLUMN source_family SET DEFAULT 'ops',
  ALTER COLUMN memory_class SET DEFAULT 'artifact',
  ALTER COLUMN quality_tier SET DEFAULT 'raw';

CREATE TABLE IF NOT EXISTS memory_stats_rollup (
  tenant_scope text PRIMARY KEY,
  total integer NOT NULL DEFAULT 0,
  last_captured_at timestamptz NULL,
  by_source jsonb NOT NULL DEFAULT '[]'::jsonb,
  by_source_family jsonb NOT NULL DEFAULT '[]'::jsonb,
  by_memory_class jsonb NOT NULL DEFAULT '[]'::jsonb,
  by_quality_tier jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_swarm_memory_tenant_source_key_recent
  ON swarm_memory (tenant_id, source_key, (COALESCE(occurred_at, created_at)) DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_memory_tenant_source_family_recent
  ON swarm_memory (tenant_id, source_family, (COALESCE(occurred_at, created_at)) DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_memory_tenant_class_quality_recent
  ON swarm_memory (tenant_id, memory_class, quality_tier, (COALESCE(occurred_at, created_at)) DESC, created_at DESC);
