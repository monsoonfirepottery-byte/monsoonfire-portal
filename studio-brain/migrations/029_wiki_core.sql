CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS wiki_source (
  source_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  source_kind text NOT NULL CHECK (source_kind IN ('repo-file', 'artifact', 'memory-export', 'external-url', 'human-note')),
  source_path text NULL,
  source_uri text NULL,
  title text NULL,
  authority_class text NOT NULL DEFAULT 'repo' CHECK (authority_class IN ('repo', 'policy', 'live-check', 'human', 'external', 'derived')),
  content_hash text NULL,
  git_sha text NULL,
  freshness_status text NOT NULL DEFAULT 'fresh' CHECK (freshness_status IN ('fresh', 'aging', 'stale', 'unknown')),
  ingest_status text NOT NULL DEFAULT 'indexed' CHECK (ingest_status IN ('indexed', 'unchanged', 'denied', 'missing', 'error')),
  deny_reason text NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_indexed_at timestamptz NULL,
  last_changed_at timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wiki_source_path_or_uri CHECK (source_path IS NOT NULL OR source_uri IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS wiki_source_chunk (
  chunk_id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES wiki_source(source_id) ON DELETE CASCADE,
  tenant_scope text NOT NULL DEFAULT '',
  chunk_index integer NOT NULL,
  line_start integer NULL,
  line_end integer NULL,
  heading_path text[] NOT NULL DEFAULT ARRAY[]::text[],
  content_hash text NOT NULL,
  content text NOT NULL,
  content_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', COALESCE(content, ''))) STORED,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, chunk_index)
);

CREATE TABLE IF NOT EXISTS wiki_claim (
  claim_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  claim_fingerprint text NOT NULL,
  claim_kind text NOT NULL DEFAULT 'fact' CHECK (claim_kind IN ('fact', 'inferred_summary', 'decision', 'procedure', 'policy', 'guardrail', 'context')),
  status text NOT NULL DEFAULT 'EXTRACTED' CHECK (
    status IN (
      'RAW_CAPTURED',
      'EXTRACTED',
      'SYNTHESIZED',
      'VERIFIED',
      'OPERATIONAL_TRUTH',
      'STALE',
      'DEPRECATED',
      'CONTRADICTORY',
      'NEEDS_HUMAN_REVIEW'
    )
  ),
  truth_status text NOT NULL DEFAULT 'known_truth' CHECK (
    truth_status IN ('known_truth', 'inferred_summary', 'stale', 'deprecated', 'unverified_idea', 'contradictory')
  ),
  confidence real NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  subject_key text NOT NULL,
  predicate_key text NOT NULL,
  object_key text NULL,
  object_text text NOT NULL,
  qualifiers jsonb NOT NULL DEFAULT '{}'::jsonb,
  owner text NULL,
  authority_class text NOT NULL DEFAULT 'repo' CHECK (authority_class IN ('repo', 'policy', 'live-check', 'human', 'external', 'derived')),
  freshness_status text NOT NULL DEFAULT 'fresh' CHECK (freshness_status IN ('fresh', 'aging', 'stale', 'unknown')),
  operational_status text NOT NULL DEFAULT 'active' CHECK (operational_status IN ('active', 'cooling', 'deprecated', 'archived')),
  agent_allowed_use text NOT NULL DEFAULT 'planning_context' CHECK (
    agent_allowed_use IN ('do_not_use', 'cite_only', 'planning_context', 'operational_context')
  ),
  requires_human_approval boolean NOT NULL DEFAULT false,
  human_approval_reason text NULL,
  last_verified_at timestamptz NULL,
  valid_until timestamptz NULL,
  supersedes jsonb NOT NULL DEFAULT '[]'::jsonb,
  superseded_by jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wiki_claim_revision (
  revision_id text PRIMARY KEY,
  claim_id text NOT NULL REFERENCES wiki_claim(claim_id) ON DELETE CASCADE,
  tenant_scope text NOT NULL DEFAULT '',
  from_status text NULL,
  to_status text NOT NULL,
  from_truth_status text NULL,
  to_truth_status text NOT NULL,
  actor text NOT NULL DEFAULT 'script:wiki-postgres',
  reason text NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wiki_claim_source_ref (
  ref_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  claim_id text NOT NULL REFERENCES wiki_claim(claim_id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES wiki_source(source_id) ON DELETE CASCADE,
  chunk_id text NULL REFERENCES wiki_source_chunk(chunk_id) ON DELETE SET NULL,
  ref_role text NOT NULL DEFAULT 'supports' CHECK (ref_role IN ('supports', 'contradicts', 'supersedes', 'context')),
  ref_label text NULL,
  line_start integer NULL,
  line_end integer NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (claim_id, source_id, chunk_id, ref_role)
);

CREATE TABLE IF NOT EXISTS wiki_page (
  page_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  markdown_path text NOT NULL,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('operational_truth', 'concept', 'workflow', 'decision', 'contradiction', 'context_pack', 'idle_task', 'audit', 'deprecated')),
  status text NOT NULL DEFAULT 'SYNTHESIZED' CHECK (
    status IN (
      'RAW_CAPTURED',
      'EXTRACTED',
      'SYNTHESIZED',
      'VERIFIED',
      'OPERATIONAL_TRUTH',
      'STALE',
      'DEPRECATED',
      'CONTRADICTORY',
      'NEEDS_HUMAN_REVIEW'
    )
  ),
  confidence real NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  owner text NULL,
  agent_allowed_use text NOT NULL DEFAULT 'planning_context' CHECK (
    agent_allowed_use IN ('do_not_use', 'cite_only', 'planning_context', 'operational_context')
  ),
  frontmatter jsonb NOT NULL DEFAULT '{}'::jsonb,
  rendered_markdown text NOT NULL DEFAULT '',
  export_hash text NULL,
  last_verified_at timestamptz NULL,
  valid_until timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_scope, markdown_path)
);

CREATE TABLE IF NOT EXISTS wiki_page_claim (
  page_id text NOT NULL REFERENCES wiki_page(page_id) ON DELETE CASCADE,
  claim_id text NOT NULL REFERENCES wiki_claim(claim_id) ON DELETE CASCADE,
  tenant_scope text NOT NULL DEFAULT '',
  relation_role text NOT NULL DEFAULT 'includes',
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (page_id, claim_id, relation_role)
);

CREATE TABLE IF NOT EXISTS wiki_relation (
  relation_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  from_id text NOT NULL,
  from_type text NOT NULL CHECK (from_type IN ('source', 'chunk', 'claim', 'page', 'contradiction', 'context_pack', 'idle_task')),
  to_id text NOT NULL,
  to_type text NOT NULL CHECK (to_type IN ('source', 'chunk', 'claim', 'page', 'contradiction', 'context_pack', 'idle_task')),
  relation_type text NOT NULL,
  weight real NOT NULL DEFAULT 0.5 CHECK (weight >= 0 AND weight <= 1),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_scope, from_id, from_type, to_id, to_type, relation_type)
);

CREATE TABLE IF NOT EXISTS wiki_contradiction (
  contradiction_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  conflict_fingerprint text NOT NULL,
  conflict_key text NOT NULL,
  severity text NOT NULL DEFAULT 'soft' CHECK (severity IN ('soft', 'hard', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in-review', 'resolved', 'dismissed')),
  claim_a_id text NULL REFERENCES wiki_claim(claim_id) ON DELETE SET NULL,
  claim_b_id text NULL REFERENCES wiki_claim(claim_id) ON DELETE SET NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner text NULL,
  recommended_action text NULL,
  markdown_path text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz NULL
);

CREATE TABLE IF NOT EXISTS wiki_context_pack (
  context_pack_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  pack_key text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'stale', 'deprecated', 'draft')),
  generated_text text NOT NULL,
  budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  export_hash text NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_scope, pack_key, generated_at)
);

CREATE TABLE IF NOT EXISTS wiki_context_pack_item (
  context_pack_id text NOT NULL REFERENCES wiki_context_pack(context_pack_id) ON DELETE CASCADE,
  tenant_scope text NOT NULL DEFAULT '',
  item_id text NOT NULL,
  item_type text NOT NULL CHECK (item_type IN ('claim', 'page', 'source', 'contradiction', 'warning')),
  sort_order integer NOT NULL DEFAULT 0,
  included_status text NOT NULL DEFAULT 'included' CHECK (included_status IN ('included', 'warning', 'excluded')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (context_pack_id, item_id, item_type)
);

CREATE TABLE IF NOT EXISTS wiki_idle_task (
  task_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  task_key text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'running', 'blocked', 'completed', 'dismissed')),
  priority real NOT NULL DEFAULT 0.5 CHECK (priority >= 0 AND priority <= 1),
  read_only boolean NOT NULL DEFAULT true,
  next_run_at timestamptz NULL,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_artifact_path text NULL,
  idempotency_key text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_scope, task_key)
);

CREATE TABLE IF NOT EXISTS wiki_job_run (
  job_run_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  job_name text NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('planned', 'running', 'passed', 'warning', 'failed', 'skipped')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  duration_ms integer NULL,
  dry_run boolean NOT NULL DEFAULT true,
  output_artifact_path text NULL,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS wiki_export_manifest (
  manifest_id text PRIMARY KEY,
  tenant_scope text NOT NULL DEFAULT '',
  export_kind text NOT NULL CHECK (export_kind IN ('markdown', 'jsonl', 'context-pack', 'source-index', 'audit')),
  export_path text NOT NULL,
  export_hash text NOT NULL,
  source_row_count integer NOT NULL DEFAULT 0,
  claim_row_count integer NOT NULL DEFAULT 0,
  page_row_count integer NOT NULL DEFAULT 0,
  contradiction_row_count integer NOT NULL DEFAULT 0,
  generated_by text NOT NULL DEFAULT 'script:wiki-postgres',
  generated_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_scope, export_kind, export_path, export_hash)
);
