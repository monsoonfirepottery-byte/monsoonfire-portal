import type { Pool } from "pg";
import { getPgPool } from "../db/postgres";

export type WikiContextPackRecord = {
  contextPackId: string;
  tenantScope: string;
  packKey: string;
  title: string;
  status: string;
  generatedText: string;
  budget: Record<string, unknown>;
  warnings: unknown[];
  exportHash: string | null;
  generatedAt: string;
  validUntil: string | null;
  metadata: Record<string, unknown>;
};

export type WikiContradictionRecord = {
  contradictionId: string;
  tenantScope: string;
  conflictKey: string;
  severity: string;
  status: string;
  claimAId: string | null;
  claimBId: string | null;
  sourceRefs: unknown[];
  owner: string | null;
  recommendedAction: string | null;
  markdownPath: string | null;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  metadata: Record<string, unknown>;
};

export type WikiSourceFreshnessRecord = {
  sourceId: string;
  tenantScope: string;
  sourceKind: string;
  sourcePath: string | null;
  sourceUri: string | null;
  authorityClass: string;
  contentHash: string | null;
  freshnessStatus: string;
  ingestStatus: string;
  denyReason: string | null;
  lastIndexedAt: string | null;
  lastChangedAt: string | null;
  updatedAt: string;
  metadata: Record<string, unknown>;
};

export type WikiSearchResult = {
  itemType: "claim" | "source_chunk" | "page";
  itemId: string;
  title: string;
  snippet: string;
  status: string | null;
  sourcePath: string | null;
  rank: number;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
};

export type WikiReadStore = {
  getContextPack(input: { tenantScope: string; packKey: string }): Promise<WikiContextPackRecord | null>;
  listContradictions(input: { tenantScope: string; status?: string | null; limit: number }): Promise<WikiContradictionRecord[]>;
  listSourceFreshness(input: { tenantScope: string; status?: string | null; limit: number }): Promise<WikiSourceFreshnessRecord[]>;
  search(input: { tenantScope: string; query: string; limit: number }): Promise<WikiSearchResult[]>;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? "");
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

function mapContextPack(row: Record<string, unknown>): WikiContextPackRecord {
  return {
    contextPackId: String(row.context_pack_id),
    tenantScope: String(row.tenant_scope),
    packKey: String(row.pack_key),
    title: String(row.title),
    status: String(row.status),
    generatedText: String(row.generated_text ?? ""),
    budget: asObject(row.budget),
    warnings: asArray(row.warnings),
    exportHash: row.export_hash === null ? null : String(row.export_hash ?? ""),
    generatedAt: toIso(row.generated_at),
    validUntil: toIsoOrNull(row.valid_until),
    metadata: asObject(row.metadata),
  };
}

function mapContradiction(row: Record<string, unknown>): WikiContradictionRecord {
  return {
    contradictionId: String(row.contradiction_id),
    tenantScope: String(row.tenant_scope),
    conflictKey: String(row.conflict_key),
    severity: String(row.severity),
    status: String(row.status),
    claimAId: row.claim_a_id === null ? null : String(row.claim_a_id ?? ""),
    claimBId: row.claim_b_id === null ? null : String(row.claim_b_id ?? ""),
    sourceRefs: asArray(row.source_refs),
    owner: row.owner === null ? null : String(row.owner ?? ""),
    recommendedAction: row.recommended_action === null ? null : String(row.recommended_action ?? ""),
    markdownPath: row.markdown_path === null ? null : String(row.markdown_path ?? ""),
    openedAt: toIso(row.opened_at),
    updatedAt: toIso(row.updated_at),
    resolvedAt: toIsoOrNull(row.resolved_at),
    metadata: asObject(row.metadata),
  };
}

function mapSourceFreshness(row: Record<string, unknown>): WikiSourceFreshnessRecord {
  return {
    sourceId: String(row.source_id),
    tenantScope: String(row.tenant_scope),
    sourceKind: String(row.source_kind),
    sourcePath: row.source_path === null ? null : String(row.source_path ?? ""),
    sourceUri: row.source_uri === null ? null : String(row.source_uri ?? ""),
    authorityClass: String(row.authority_class),
    contentHash: row.content_hash === null ? null : String(row.content_hash ?? ""),
    freshnessStatus: String(row.freshness_status),
    ingestStatus: String(row.ingest_status),
    denyReason: row.deny_reason === null ? null : String(row.deny_reason ?? ""),
    lastIndexedAt: toIsoOrNull(row.last_indexed_at),
    lastChangedAt: toIsoOrNull(row.last_changed_at),
    updatedAt: toIso(row.updated_at),
    metadata: asObject(row.metadata),
  };
}

function mapSearchResult(row: Record<string, unknown>): WikiSearchResult {
  return {
    itemType: row.item_type === "source_chunk" || row.item_type === "page" ? row.item_type : "claim",
    itemId: String(row.item_id),
    title: String(row.title ?? ""),
    snippet: String(row.snippet ?? ""),
    status: row.status === null ? null : String(row.status ?? ""),
    sourcePath: row.source_path === null ? null : String(row.source_path ?? ""),
    rank: Number(row.rank ?? 0),
    updatedAt: toIsoOrNull(row.updated_at),
    metadata: asObject(row.metadata),
  };
}

export function createPostgresWikiReadStore(poolProvider: () => Pool = getPgPool): WikiReadStore {
  return {
    async getContextPack({ tenantScope, packKey }) {
      const result = await poolProvider().query(
        `SELECT context_pack_id, tenant_scope, pack_key, title, status, generated_text, budget, warnings,
                export_hash, generated_at, valid_until, metadata
           FROM wiki_context_pack
          WHERE tenant_scope = $1 AND pack_key = $2 AND status = 'active'
          ORDER BY generated_at DESC
          LIMIT 1`,
        [tenantScope, packKey],
      );
      return result.rows[0] ? mapContextPack(result.rows[0]) : null;
    },

    async listContradictions({ tenantScope, status, limit }) {
      const result = await poolProvider().query(
        `SELECT contradiction_id, tenant_scope, conflict_key, severity, status, claim_a_id, claim_b_id,
                source_refs, owner, recommended_action, markdown_path, opened_at, updated_at, resolved_at, metadata
           FROM wiki_contradiction
          WHERE tenant_scope = $1 AND ($2::text IS NULL OR status = $2)
          ORDER BY CASE severity WHEN 'critical' THEN 3 WHEN 'hard' THEN 2 ELSE 1 END DESC, updated_at DESC
          LIMIT $3`,
        [tenantScope, status || null, limit],
      );
      return result.rows.map(mapContradiction);
    },

    async listSourceFreshness({ tenantScope, status, limit }) {
      const result = await poolProvider().query(
        `SELECT source_id, tenant_scope, source_kind, source_path, source_uri, authority_class, content_hash,
                freshness_status, ingest_status, deny_reason, last_indexed_at, last_changed_at, updated_at, metadata
           FROM wiki_source
          WHERE tenant_scope = $1
            AND ($2::text IS NULL OR freshness_status = $2 OR ingest_status = $2)
          ORDER BY last_indexed_at DESC NULLS LAST, updated_at DESC
          LIMIT $3`,
        [tenantScope, status || null, limit],
      );
      return result.rows.map(mapSourceFreshness);
    },

    async search({ tenantScope, query, limit }) {
      const likeQuery = `%${query.replace(/[%_]/g, "\\$&")}%`;
      const result = await poolProvider().query(
        `WITH searched_claims AS (
            SELECT 'claim'::text AS item_type,
                   claim_id AS item_id,
                   subject_key AS title,
                   left(object_text, 600) AS snippet,
                   status,
                   NULL::text AS source_path,
                   ts_rank(to_tsvector('english', object_text), plainto_tsquery('english', $2)) AS rank,
                   updated_at,
                   metadata
              FROM wiki_claim
             WHERE tenant_scope = $1
               AND status NOT IN ('DEPRECATED')
               AND (
                 to_tsvector('english', object_text) @@ plainto_tsquery('english', $2)
                 OR subject_key ILIKE $3 ESCAPE '\\'
                 OR predicate_key ILIKE $3 ESCAPE '\\'
               )
          ), searched_chunks AS (
            SELECT 'source_chunk'::text AS item_type,
                   chunk.chunk_id AS item_id,
                   source.source_path AS title,
                   left(chunk.content, 600) AS snippet,
                   NULL::text AS status,
                   source.source_path,
                   ts_rank(chunk.content_tsv, plainto_tsquery('english', $2)) AS rank,
                   chunk.updated_at,
                   chunk.metadata
              FROM wiki_source_chunk chunk
              JOIN wiki_source source ON source.source_id = chunk.source_id
             WHERE chunk.tenant_scope = $1
               AND (
                 chunk.content_tsv @@ plainto_tsquery('english', $2)
                 OR chunk.content ILIKE $3 ESCAPE '\\'
                 OR source.source_path ILIKE $3 ESCAPE '\\'
               )
          )
          SELECT * FROM searched_claims
          UNION ALL
          SELECT * FROM searched_chunks
          ORDER BY rank DESC, updated_at DESC NULLS LAST
          LIMIT $4`,
        [tenantScope, query, likeQuery, limit],
      );
      return result.rows.map(mapSearchResult);
    },
  };
}
