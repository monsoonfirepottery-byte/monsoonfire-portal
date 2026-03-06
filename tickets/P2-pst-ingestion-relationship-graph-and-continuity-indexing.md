# P2 — PST Canonical Corpus, Relationship Graph, and Timeline Indexing

Status: Open  
Date: 2026-03-03  
Priority: P2  
Owner: Platform / Studio Brain / Codex  
Type: Ticket  
Parent Epic: docs/epics/EPIC-PST-INGESTION-RELATIONSHIP-INDEXING.md

## Problem

The PST and adjacent corpora are huge and valuable, but recall is mostly source- and text-centric. As context windows grow, we lose continuity across sessions unless high-signal links are extracted.

## Objective

Convert the PST corpus and adjacent digital logs into a canonical, provenance-rich evidence corpus that preserves:
- who we are and what role-context applies,
- what workstreams, contacts, and relationship channels were active,
- what decisions, commitments, and influence patterns emerged,
- what attachments, docs, headers, and mailbox-routing signals shaped those outcomes,
while keeping any still-used downstream adapters backward-compatible.

## Tasks

1. Define an append-only canonical corpus model:
   - `source_unit`, `fact_event`, `hypothesis`, and `dossier`,
   - directional edges with typed edge vocabulary,
   - confidence score, reason, provenance, timestamps, and effective time window metadata.
2. Add PST-to-corpus parser improvements for:
   - sender/recipient normalization,
   - thread reconstruction (reply chain + subject-like and quoted-message stitching),
   - duplicate / near-duplicate collapse,
   - confidence scoring per extracted statement,
   - identity alias merging (`Micah`, `wuff`, email aliases, handles),
   - header capture (`messageId`, `inReplyTo`, `references`, `conversationId`, routing/mailbox fields),
   - attachment/doc capture (names, mime types, hashes, extracted text summaries, counts).
3. Add automatic entity extraction/normalization (people, projects/tickets, decisions, entities already represented in content) used to seed relationship candidates.
4. Add relationship creation rules at corpus build time:
   - explicit edges from payload fields when present (`relations`/`relatedTo`)
   - inferred edges from recurring identifiers and thread-topic similarity
   - safe conflict edges when semantic reversal markers indicate contradiction.
5. Emit corpus artifacts and local analysis surfaces:
   - JSONL outputs per layer,
   - SQLite materialization for local interrogation,
   - markdown dossiers for decision/influence/relationship/document review.
6. Add optional downstream adapters:
   - Open Memory / Studio Brain export,
   - bounded context export for future stateful-memory systems,
   - local query helpers that operate on corpus artifacts instead of raw PST exports.
7. Add migration/backfill task for existing records with dry-run and bounded batch modes, including PST corpus re-encode and thread re-mapping.
8. Add corpus quality outputs:
   - relationship quality scorecard,
   - attachment/doc capture coverage,
   - recurring contact coverage,
   - unresolved conflict edges,
   - header/thread-link completeness.

## Acceptance Criteria

1. A corpus run emits append-only layered artifacts with provenance-rich source capture.
2. Attachments, docs, contacts, and headers are preserved as first-class signal and available for downstream analysis.
3. Relationship and influence hypotheses are emitted without merging inference into fact records.
4. Corpus artifacts can be materialized locally and queried without requiring the runtime memory adapter.
5. Migration/backfill can be run idempotently and resumes safely after interruption.
6. At least one end-to-end regression validates PST thread reconstruction, cross-reference linking, and derived dossier generation from the same corpus run.
