CREATE INDEX IF NOT EXISTS idx_wiki_source_ingest_recent
  ON wiki_source (tenant_scope, ingest_status, last_indexed_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_source_path_unique
  ON wiki_source (tenant_scope, source_path)
  WHERE source_path IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_source_uri_unique
  ON wiki_source (tenant_scope, source_uri)
  WHERE source_uri IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wiki_source_content_hash
  ON wiki_source (tenant_scope, content_hash, updated_at DESC)
  WHERE content_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wiki_source_chunk_source_line
  ON wiki_source_chunk (tenant_scope, source_id, line_start);

CREATE INDEX IF NOT EXISTS idx_wiki_source_chunk_tsv
  ON wiki_source_chunk USING gin (content_tsv);

CREATE INDEX IF NOT EXISTS idx_wiki_source_chunk_trgm
  ON wiki_source_chunk USING gin (content gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_wiki_claim_state
  ON wiki_claim (tenant_scope, status, truth_status, operational_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_claim_subject_predicate
  ON wiki_claim (tenant_scope, subject_key, predicate_key, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_claim_active_fingerprint_unique
  ON wiki_claim (tenant_scope, claim_fingerprint)
  WHERE status NOT IN ('DEPRECATED', 'STALE');

CREATE INDEX IF NOT EXISTS idx_wiki_claim_approval
  ON wiki_claim (tenant_scope, requires_human_approval, status, updated_at DESC)
  WHERE requires_human_approval = true;

CREATE INDEX IF NOT EXISTS idx_wiki_claim_source_ref_claim
  ON wiki_claim_source_ref (claim_id);

CREATE INDEX IF NOT EXISTS idx_wiki_claim_source_ref_source
  ON wiki_claim_source_ref (tenant_scope, source_id, chunk_id, ref_role);

CREATE INDEX IF NOT EXISTS idx_wiki_page_kind_status
  ON wiki_page (tenant_scope, kind, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_page_agent_use
  ON wiki_page (tenant_scope, agent_allowed_use, status, last_verified_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_page_claim_claim
  ON wiki_page_claim (claim_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_wiki_relation_from
  ON wiki_relation (tenant_scope, from_id, from_type, relation_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_relation_to
  ON wiki_relation (tenant_scope, to_id, to_type, relation_type, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_contradiction_queue
  ON wiki_contradiction (tenant_scope, status, severity, updated_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wiki_contradiction_active_unique
  ON wiki_contradiction (tenant_scope, conflict_fingerprint)
  WHERE status IN ('open', 'in-review');

CREATE INDEX IF NOT EXISTS idx_wiki_context_pack_latest
  ON wiki_context_pack (tenant_scope, pack_key, status, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_context_pack_item_lookup
  ON wiki_context_pack_item (tenant_scope, item_type, item_id);

CREATE INDEX IF NOT EXISTS idx_wiki_idle_task_ready
  ON wiki_idle_task (tenant_scope, status, priority DESC, next_run_at ASC);

CREATE INDEX IF NOT EXISTS idx_wiki_job_run_recent
  ON wiki_job_run (tenant_scope, job_name, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_wiki_export_manifest_recent
  ON wiki_export_manifest (tenant_scope, export_kind, generated_at DESC);
