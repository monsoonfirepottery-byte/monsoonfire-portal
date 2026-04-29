ALTER TABLE wiki_source
  ADD COLUMN IF NOT EXISTS missing_since_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE wiki_source_chunk
  ADD COLUMN IF NOT EXISTS source_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS superseded_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS superseded_by_chunk_id text NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'wiki_source_chunk_source_id_chunk_index_key'
       AND conrelid = 'wiki_source_chunk'::regclass
  ) THEN
    ALTER TABLE wiki_source_chunk
      DROP CONSTRAINT wiki_source_chunk_source_id_chunk_index_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_source_chunk_active_source_index
  ON wiki_source_chunk (source_id, chunk_index)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_wiki_source_missing
  ON wiki_source (tenant_scope, ingest_status, missing_since_at DESC)
  WHERE ingest_status = 'missing';

CREATE INDEX IF NOT EXISTS idx_wiki_source_chunk_active_lookup
  ON wiki_source_chunk (tenant_scope, source_id, is_active, line_start);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'wiki_contradiction_status_check'
       AND conrelid = 'wiki_contradiction'::regclass
  ) THEN
    ALTER TABLE wiki_contradiction
      DROP CONSTRAINT wiki_contradiction_status_check;
  END IF;
END $$;

ALTER TABLE wiki_contradiction
  ADD CONSTRAINT wiki_contradiction_status_check
  CHECK (status IN ('open', 'in-review', 'blocked', 'resolved', 'dismissed'));

DROP INDEX IF EXISTS idx_wiki_contradiction_active_unique;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_contradiction_active_unique
  ON wiki_contradiction (tenant_scope, conflict_fingerprint)
  WHERE status IN ('open', 'in-review', 'blocked');

CREATE INDEX IF NOT EXISTS idx_wiki_idle_task_lease
  ON wiki_idle_task (tenant_scope, status, priority DESC, next_run_at ASC, updated_at ASC)
  WHERE status = 'ready';
