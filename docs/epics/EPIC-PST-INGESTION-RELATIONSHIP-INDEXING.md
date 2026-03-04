# EPIC: PST-INGESTION

Status: Active  
Owner: Platform / Studio Brain  
Created: 2026-03-03  
Priority: P2

## Mission

Turn high-volume PST/data exports into continuity-preserving memory so each Codex session can restart with context and continue seamlessly:
- who you are and what role-context applies,
- what we were doing in the last active shell,
- which workstreams are live,
- and which worker/process handoff was pending.

## Why This Exists

The corpus is rich but noisy: years of email threads, correspondence, social logs, and operational notes exist as raw streams. The current approach is mostly source-centric and can miss the high-signal edges needed to preserve continuity. We need structured indexing to support:
- decision lineage
- conflict checks
- related context recall
- cross-ticket/station/workflow tracing
- resume continuity from restart to restart with sub-second retrieval

## Scope

- PST-specific ingestion upgrades:
  - deterministic identity extraction (people, orgs, aliases, email/channel IDs),
  - thread and reply reconstruction with quoted-message stitching,
  - dedupe and near-dedupe collapse for duplicated logs,
  - high-signal event extraction (decisions, commitments, blockers, asks, approvals, handoffs, open loops),
  - provenance capture (source, timestamp, sender/recipient, reply depth, thread root).
- Relationship indexing model:
  - directional edges with explicit types such as `references`, `dependsOn`, `conflictsWith`, `follows`, `causedBy`,
  - confidence + reason + provenance + effective time window metadata.
- Cross-reference graph and entity graph construction:
  - people/project/ticket/workflow nodes,
  - explicit and inferred edge paths,
  - conflict-aware edge representation.
- Relationship-aware query and neighborhood discovery:
  - `/api/memory/search?expandRelationships=true&maxHops=N`,
  - `/api/memory/context` continuity projection consumed at startup.
  - `/api/memory/neighborhood` for seed-id neighborhood retrieval with explicit hop/node budgets.
  - `/api/memory/relationship-diagnostics` for edge summary + relationship-type diagnostics previews.
- Continuity projection to support shell handoff:
  - active identity/profile anchors,
  - “what we were doing 3 seconds ago” reconstruction,
  - active worker/process handoff state,
  - unresolved actions + evidence links.
- Migration and reliability:
  - backfill and idempotent recompute for existing rows,
  - dry-run + bounded batching + resumable checkpoints.
- Observability:
  - edge cardinality trend,
  - orphan/topology quality,
  - stale link ratio,
  - inverse-link mismatch and unresolved conflict edges.
- Keep schema migration safe under stateless function execution and preserve existing API contracts.

## Out of Scope

- Full LLM-based semantic summarization in this epic.
- Replacing source-of-truth documents or operational Firestore schemas in the Portal app.

## Tickets

- `tickets/P2-pst-ingestion-relationship-graph-and-continuity-indexing.md`

## Acceptance Criteria

1. PST parsing increases continuity recall against the same input sample (with no increase in false positives for existing search baseline).
2. API returns relationship-aware suggestions for both an item ID and query without breaking existing query semantics.
3. New relationships are created automatically for new ingests and can be appended for legacy imports.
4. Conflicting/contradictory relationships are represented with explicit edge types and conflict metadata.
5. Continuity projection can answer:
   - "who are we",
   - "what we were doing in the last active shell",
   - and "what is the current worker/process handoff state" after restart.
6. Continuity bootstrap artifacts for restart are regenerated deterministically and consume within startup budget.
7. Recompute/migration path for existing memory data is idempotent and auditable.

## API Contracts (2026-03-04)

### `POST /api/memory/neighborhood`

Request body:
- `seedMemoryId` (required, string)
- `maxHops` (optional, int `1..4`, default `2`)
- `maxItems` (optional, int `1..100`, default `24`)
- `includeSeed` (optional, boolean, default `true`)
- optional pass-through controls: `tenantId`, `agentId`, `runId`, `query`, `sourceAllowlist`, `sourceDenylist`, `retrievalMode`, `temporalAnchorAt`, `includeTenantFallback`, `maxChars`, `scanLimit`

Response body:
- `neighborhood` with `seedMemoryId`, `maxHops`, `maxItems`, `nodes[]`, `selection`, `budget`
- `edgeSummary` with `nodeCount`, `edgeCount`, `internalEdgeCount`, `externalEdgeCount`, `relationshipTypes`, `unresolvedConflictCount`
- `relationshipTypeCounts` map
- `diagnostics.previewSummaries[]` for quick human inspection

### `POST /api/memory/relationship-diagnostics`

Request body:
- requires at least one of:
  - `seedMemoryId` (string)
  - `query` (string)
- supports `maxHops`, `maxItems`, `includeSeed`, and the same optional pass-through controls as neighborhood.

Response body:
- `diagnostics.edgeSummary` with edge totals + unresolved conflict count
- `diagnostics.relationshipTypeCounts` map
- `diagnostics.unresolvedConflicts[]` sample rows
- `diagnostics.previewSummaries[]` short node previews
- includes resolved request envelope (`query`, `maxHops`, `maxItems`, `selection`, `budget`) for traceability
