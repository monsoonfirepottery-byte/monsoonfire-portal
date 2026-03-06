CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE swarm_memory
  ADD COLUMN IF NOT EXISTS occurred_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'proposed',
  ADD COLUMN IF NOT EXISTS memory_type text NOT NULL DEFAULT 'episodic',
  ADD COLUMN IF NOT EXISTS source_confidence real NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS importance real NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS contextualized_content text NULL,
  ADD COLUMN IF NOT EXISTS fingerprint text NULL,
  ADD COLUMN IF NOT EXISTS embedding_model text NULL,
  ADD COLUMN IF NOT EXISTS embedding_version int NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'swarm_memory_status_check'
  ) THEN
    ALTER TABLE swarm_memory
      ADD CONSTRAINT swarm_memory_status_check
      CHECK (status IN ('proposed', 'accepted', 'quarantined', 'archived'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'swarm_memory_memory_type_check'
  ) THEN
    ALTER TABLE swarm_memory
      ADD CONSTRAINT swarm_memory_memory_type_check
      CHECK (memory_type IN ('working', 'episodic', 'semantic', 'procedural'));
  END IF;
END
$$;

UPDATE swarm_memory
   SET occurred_at = created_at
 WHERE occurred_at IS NULL;

UPDATE swarm_memory
   SET first_seen_at = created_at
 WHERE first_seen_at IS NULL;

UPDATE swarm_memory
   SET last_seen_at = created_at
 WHERE last_seen_at IS NULL;

UPDATE swarm_memory
   SET contextualized_content = content
 WHERE contextualized_content IS NULL;

CREATE INDEX IF NOT EXISTS idx_swarm_memory_scope_status_occured
  ON swarm_memory (tenant_id, agent_id, run_id, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_memory_tenant_status_created
  ON swarm_memory (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_memory_status_confidence
  ON swarm_memory (status, source_confidence DESC, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_swarm_memory_contextualized_tsv
  ON swarm_memory
  USING gin (to_tsvector('english', COALESCE(contextualized_content, content)));

CREATE INDEX IF NOT EXISTS idx_swarm_memory_contextualized_trgm
  ON swarm_memory
  USING gin (contextualized_content gin_trgm_ops);

CREATE UNIQUE INDEX IF NOT EXISTS idx_swarm_memory_tenant_fingerprint_unique
  ON swarm_memory (tenant_id, fingerprint)
  WHERE fingerprint IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS idx_swarm_memory_embedding_cosine ON swarm_memory USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100)';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS memory_retrieval_event (
  event_id text PRIMARY KEY,
  tenant_id text NULL,
  agent_id text NULL,
  run_id text NULL,
  query text NOT NULL,
  retrieval_mode text NOT NULL,
  candidate_count int NOT NULL DEFAULT 0,
  selected_count int NOT NULL DEFAULT 0,
  selected_memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  score_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_retrieval_event_created_at
  ON memory_retrieval_event (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_retrieval_event_scope
  ON memory_retrieval_event (tenant_id, agent_id, run_id, created_at DESC);

CREATE TABLE IF NOT EXISTS memory_ingest_event (
  event_id text PRIMARY KEY,
  tenant_id text NULL,
  source text NOT NULL,
  decision text NOT NULL,
  memory_id text NULL,
  fingerprint text NULL,
  reason text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_ingest_event_created_at
  ON memory_ingest_event (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_ingest_event_source_decision
  ON memory_ingest_event (source, decision, created_at DESC);
