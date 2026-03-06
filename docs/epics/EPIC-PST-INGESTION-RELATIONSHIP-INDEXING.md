# EPIC: PST-INGESTION

Status: Active  
Owner: Platform / Studio Brain  
Created: 2026-03-03  
Priority: P2

## Mission

Turn high-volume PST/data exports into a canonical, provenance-rich evidence corpus that future memory systems, context loaders, and analysis tools can consume reliably:
- who you are and what role-context applies,
- what decisions, commitments, and influence patterns emerged,
- which workstreams and relationship channels were active,
- and what timeline of evidence explains those conclusions.

## Why This Exists

The corpus is rich but noisy: years of email threads, correspondence, social logs, and operational notes exist as raw streams. The current approach is mostly source-centric and can miss the high-signal edges needed to preserve continuity. We need structured indexing to support:
- decision lineage
- conflict checks
- related context recall
- cross-ticket/station/workflow tracing
- downstream memory/context adapters without reprocessing the raw exports every time

## Scope

- PST-specific ingestion upgrades:
  - deterministic identity extraction (people, orgs, aliases, email/channel IDs),
  - thread and reply reconstruction with quoted-message stitching,
  - dedupe and near-dedupe collapse for duplicated logs,
  - high-signal event extraction (decisions, commitments, blockers, asks, approvals, handoffs, open loops, contact facts, attachment/document signals),
  - provenance capture (source, timestamp, sender/recipient, reply depth, thread root, headers, mailbox/folder routing, attachment metadata).
- Canonical layered corpus model:
  - append-only `source_unit`, `fact_event`, `hypothesis`, and `dossier` records,
  - confidence + reason + provenance + effective time window metadata,
  - support for attachments, docs, contacts, headers, and other source-enriched metadata as first-class signal.
- Cross-reference graph and entity graph construction inside the corpus:
  - people/project/ticket/workflow/contact/document nodes,
  - explicit and inferred edge paths,
  - conflict-aware representation.
- Timeline-first organization:
  - global chronological ledger,
  - local threads for subject/reply/contact/project views,
  - derived dossiers and influence summaries built from the record graph.
- Downstream adapters and local analysis:
  - SQLite materialization for local interrogation,
  - optional Open Memory / Studio Brain adapter output,
  - optional bounded context exports without making the runtime adapter the source of truth.
- Migration and reliability:
  - resumable, idempotent recompute for corpus artifacts,
  - dry-run + bounded batching + append-only outputs.
- Keep schema migration safe under stateless function execution and preserve compatibility for any still-used legacy adapter APIs.

## Out of Scope

- Rebuilding a bespoke long-lived runtime memory system as the primary product.
- Replacing source-of-truth documents or operational Firestore schemas in the Portal app.

## Tickets

- `tickets/P2-pst-ingestion-relationship-graph-and-continuity-indexing.md`

## Acceptance Criteria

1. PST parsing produces a canonical append-only corpus with layered records and provenance-rich source capture.
2. Attachments, docs, contacts, headers, and mailbox routing metadata are preserved as first-class corpus signal instead of being dropped into incidental metadata only.
3. New relationships and influence hypotheses are created automatically for new ingests and can be appended for legacy imports without destructive rewrites.
4. Conflicting or contradictory relationships are represented explicitly in corpus records or derived edges.
5. The same corpus can drive downstream bounded context exports, SQLite interrogation, and optional runtime adapters without reprocessing raw exports.
6. Recompute and migration for corpus artifacts are idempotent and auditable.
7. At least one end-to-end regression validates thread reconstruction, cross-reference linking, and derived dossier generation from the same corpus run.

## Corpus Contracts (2026-03-05)

Primary durable interfaces are artifact contracts rather than runtime memory APIs:

- `source_unit`
  - raw imported unit with normalized participants, timestamps, thread/header/mailbox metadata, and original-source pointers
- `fact_event`
  - extracted event or claim grounded in one or more `source_unit` ids
- `hypothesis`
  - inferred explanation or influence thesis with supporting and counter-evidence links
- `dossier`
  - human-readable markdown/report artifact built only from existing record ids

Optional downstream APIs or adapters may still consume this corpus, but they are no longer the primary contract of the epic.
