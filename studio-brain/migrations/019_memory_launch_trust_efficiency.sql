CREATE TABLE IF NOT EXISTS memory_lattice_projection (
  memory_id text PRIMARY KEY REFERENCES swarm_memory(memory_id) ON DELETE CASCADE,
  tenant_id text NULL,
  memory_layer text NOT NULL,
  status text NOT NULL,
  category text NULL,
  truth_status text NULL,
  freshness_status text NULL,
  operational_status text NULL,
  authority_class text NULL,
  review_action text NULL,
  review_priority real NOT NULL DEFAULT 0,
  folklore_risk real NOT NULL DEFAULT 0,
  contradiction_count int NOT NULL DEFAULT 0,
  conflict_severity text NULL,
  conflict_kinds jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflicting_memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  scope text NULL,
  last_verified_at timestamptz NULL,
  next_review_at timestamptz NULL,
  freshness_expires_at timestamptz NULL,
  source_class text NULL,
  has_evidence boolean NOT NULL DEFAULT false,
  redaction_state text NULL,
  secret_exposure jsonb NOT NULL DEFAULT '{}'::jsonb,
  canonical_promotion_blocked boolean NOT NULL DEFAULT false,
  secret_quarantined boolean NOT NULL DEFAULT false,
  shadow_mcp_risk boolean NOT NULL DEFAULT false,
  mcp_governed boolean NOT NULL DEFAULT false,
  mcp_approval_state text NULL,
  review_shadow_mcp boolean NOT NULL DEFAULT false,
  high_risk_shadow_mcp boolean NOT NULL DEFAULT false,
  startup_eligible boolean NOT NULL DEFAULT false,
  remember_kind text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO memory_lattice_projection (
  memory_id,
  tenant_id,
  memory_layer,
  status,
  category,
  truth_status,
  freshness_status,
  operational_status,
  authority_class,
  review_action,
  review_priority,
  folklore_risk,
  contradiction_count,
  conflict_severity,
  conflict_kinds,
  conflicting_memory_ids,
  scope,
  last_verified_at,
  next_review_at,
  freshness_expires_at,
  source_class,
  has_evidence,
  redaction_state,
  secret_exposure,
  canonical_promotion_blocked,
  secret_quarantined,
  shadow_mcp_risk,
  mcp_governed,
  mcp_approval_state,
  review_shadow_mcp,
  high_risk_shadow_mcp,
  startup_eligible,
  remember_kind,
  created_at,
  updated_at
)
SELECT
  memory_id,
  tenant_id,
  COALESCE(
    NULLIF(LOWER(metadata->>'memoryLayer'), ''),
    CASE
      WHEN LOWER(memory_type) = 'working' THEN 'working'
      WHEN LOWER(memory_type) = 'episodic' THEN 'episodic'
      WHEN LOWER(memory_type) IN ('semantic', 'procedural') THEN 'canonical'
      ELSE 'episodic'
    END
  ) AS memory_layer,
  status,
  COALESCE(NULLIF(metadata->>'memoryCategory', ''), NULLIF(metadata->'memoryLattice'->>'category', '')) AS category,
  COALESCE(NULLIF(metadata->>'truthStatus', ''), NULLIF(metadata->'memoryLattice'->>'truthStatus', '')) AS truth_status,
  COALESCE(NULLIF(metadata->>'freshnessStatus', ''), NULLIF(metadata->'memoryLattice'->>'freshnessStatus', '')) AS freshness_status,
  COALESCE(NULLIF(metadata->>'operationalStatus', ''), NULLIF(metadata->'memoryLattice'->>'operationalStatus', '')) AS operational_status,
  COALESCE(NULLIF(metadata->>'authorityClass', ''), NULLIF(metadata->'memoryLattice'->>'authorityClass', '')) AS authority_class,
  COALESCE(NULLIF(metadata->>'reviewAction', ''), NULLIF(metadata->'memoryLattice'->>'reviewAction', '')) AS review_action,
  CASE
    WHEN COALESCE(metadata->>'reviewPriority', metadata->'memoryLattice'->>'reviewPriority', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN COALESCE(metadata->>'reviewPriority', metadata->'memoryLattice'->>'reviewPriority')::real
    ELSE 0
  END AS review_priority,
  CASE
    WHEN COALESCE(metadata->>'folkloreRisk', metadata->'memoryLattice'->>'folkloreRisk', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
      THEN COALESCE(metadata->>'folkloreRisk', metadata->'memoryLattice'->>'folkloreRisk')::real
    ELSE 0
  END AS folklore_risk,
  CASE
    WHEN COALESCE(metadata->>'contradictionCount', metadata->'memoryLattice'->>'contradictionCount', '') ~ '^-?[0-9]+$'
      THEN COALESCE(metadata->>'contradictionCount', metadata->'memoryLattice'->>'contradictionCount')::int
    ELSE 0
  END AS contradiction_count,
  COALESCE(NULLIF(metadata->>'conflictSeverity', ''), NULLIF(metadata->'memoryLattice'->>'conflictSeverity', '')) AS conflict_severity,
  COALESCE(metadata->'conflictKinds', metadata->'memoryLattice'->'conflictKinds', '[]'::jsonb) AS conflict_kinds,
  COALESCE(metadata->'conflictingMemoryIds', metadata->'memoryLattice'->'conflictingMemoryIds', '[]'::jsonb) AS conflicting_memory_ids,
  COALESCE(NULLIF(metadata->>'scope', ''), NULLIF(metadata->'memoryLattice'->>'scope', '')) AS scope,
  CASE
    WHEN COALESCE(metadata->>'lastVerifiedAt', metadata->'memoryLattice'->>'lastVerifiedAt', '') ~ '^\d{4}-\d{2}-\d{2}T'
      THEN COALESCE(metadata->>'lastVerifiedAt', metadata->'memoryLattice'->>'lastVerifiedAt')::timestamptz
    ELSE NULL
  END AS last_verified_at,
  CASE
    WHEN COALESCE(metadata->>'nextReviewAt', metadata->'memoryLattice'->>'nextReviewAt', '') ~ '^\d{4}-\d{2}-\d{2}T'
      THEN COALESCE(metadata->>'nextReviewAt', metadata->'memoryLattice'->>'nextReviewAt')::timestamptz
    ELSE NULL
  END AS next_review_at,
  CASE
    WHEN COALESCE(metadata->>'freshnessExpiresAt', metadata->'memoryLattice'->>'freshnessExpiresAt', '') ~ '^\d{4}-\d{2}-\d{2}T'
      THEN COALESCE(metadata->>'freshnessExpiresAt', metadata->'memoryLattice'->>'freshnessExpiresAt')::timestamptz
    ELSE NULL
  END AS freshness_expires_at,
  COALESCE(NULLIF(metadata->>'sourceClass', ''), NULLIF(metadata->'memoryLattice'->>'sourceClass', '')) AS source_class,
  CASE
    WHEN COALESCE(metadata->>'hasEvidence', metadata->'memoryLattice'->>'hasEvidence', '') IN ('true', 't', '1') THEN true
    ELSE false
  END AS has_evidence,
  COALESCE(NULLIF(metadata->>'redactionState', ''), NULLIF(metadata->'memoryLattice'->>'redactionState', '')) AS redaction_state,
  COALESCE(metadata->'secretExposure', '{}'::jsonb) AS secret_exposure,
  CASE
    WHEN COALESCE(metadata->'secretExposure'->>'canonicalPromotionBlocked', '') IN ('true', 't', '1') THEN true
    ELSE false
  END AS canonical_promotion_blocked,
  CASE
    WHEN COALESCE(metadata->'secretExposure'->>'quarantined', '') IN ('true', 't', '1') THEN true
    ELSE false
  END AS secret_quarantined,
  CASE
    WHEN COALESCE(metadata->>'shadowMcpRisk', metadata->'memoryLattice'->>'shadowMcpRisk', metadata->'mcpGovernance'->>'shadowRisk', '') IN ('true', 't', '1')
      THEN true
    ELSE false
  END AS shadow_mcp_risk,
  CASE WHEN NULLIF(metadata->'mcpGovernance'->>'approvalState', '') IS NOT NULL THEN true ELSE false END AS mcp_governed,
  NULLIF(metadata->'mcpGovernance'->>'approvalState', '') AS mcp_approval_state,
  CASE
    WHEN COALESCE(metadata->'mcpGovernance'->>'shadowRisk', '') IN ('true', 't', '1') THEN true
    ELSE false
  END AS review_shadow_mcp,
  CASE
    WHEN COALESCE(metadata->'mcpGovernance'->>'shadowRisk', '') IN ('true', 't', '1')
      AND COALESCE(NULLIF(metadata->'mcpGovernance'->>'approvalState', ''), 'pending') <> 'approved'
      THEN true
    ELSE false
  END AS high_risk_shadow_mcp,
  CASE
    WHEN COALESCE(metadata->>'startupEligible', metadata->>'rememberForStartup', '') IN ('true', 't', '1') THEN true
    ELSE false
  END AS startup_eligible,
  NULLIF(metadata->>'rememberKind', '') AS remember_kind,
  created_at,
  now()
  FROM swarm_memory
ON CONFLICT (memory_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_memory_lattice_projection_review
  ON memory_lattice_projection (tenant_id, review_action, review_priority DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_lattice_projection_operational
  ON memory_lattice_projection (tenant_id, operational_status, truth_status, freshness_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_lattice_projection_startup
  ON memory_lattice_projection (tenant_id, startup_eligible, truth_status, operational_status, updated_at DESC)
  WHERE startup_eligible = true;

CREATE INDEX IF NOT EXISTS idx_memory_lattice_projection_secret
  ON memory_lattice_projection (tenant_id, canonical_promotion_blocked, secret_quarantined, updated_at DESC)
  WHERE canonical_promotion_blocked = true OR secret_quarantined = true;

CREATE INDEX IF NOT EXISTS idx_memory_lattice_projection_shadow_mcp
  ON memory_lattice_projection (tenant_id, shadow_mcp_risk, high_risk_shadow_mcp, mcp_governed, updated_at DESC)
  WHERE shadow_mcp_risk = true OR source_class = 'mcp-tool' OR mcp_governed = true;

CREATE TABLE IF NOT EXISTS memory_evidence (
  evidence_id text PRIMARY KEY,
  memory_id text NOT NULL REFERENCES swarm_memory(memory_id) ON DELETE CASCADE,
  tenant_id text NULL,
  source_class text NOT NULL,
  source_uri text NULL,
  source_path text NULL,
  captured_at timestamptz NOT NULL,
  verified_at timestamptz NULL,
  verifier text NULL,
  redaction_state text NOT NULL DEFAULT 'none',
  hash text NULL,
  supports_memory_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_evidence_memory
  ON memory_evidence (memory_id, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_evidence_tenant_source
  ON memory_evidence (tenant_id, source_class, captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_evidence_redaction
  ON memory_evidence (tenant_id, redaction_state, updated_at DESC);

CREATE TABLE IF NOT EXISTS memory_transition_event (
  transition_id text PRIMARY KEY,
  memory_id text NOT NULL REFERENCES swarm_memory(memory_id) ON DELETE CASCADE,
  tenant_id text NULL,
  actor text NULL,
  reason text NULL,
  at timestamptz NOT NULL,
  from_status text NULL,
  to_status text NOT NULL,
  from_truth_status text NULL,
  to_truth_status text NOT NULL,
  from_freshness_status text NULL,
  to_freshness_status text NOT NULL,
  from_operational_status text NULL,
  to_operational_status text NOT NULL,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_memory_transition_event_memory
  ON memory_transition_event (memory_id, at DESC);

CREATE INDEX IF NOT EXISTS idx_memory_transition_event_tenant
  ON memory_transition_event (tenant_id, at DESC);
