# Canonical Memory Corpus

This project now treats the source-processed corpus as the durable asset and any runtime memory backend as an adapter target.

## Purpose

- Keep the heavy lift focused on extracting signal from raw sources instead of trying to own the final stateful memory runtime.
- Preserve evidence, timelines, and provenance so future memory systems can import a cleaner, richer, more trustworthy view.
- Mine for decisions, influence, and "why" while keeping inferred claims separate from directly supported facts.
- Treat attachment payloads, document metadata, recurring contacts, and other source-enriched fields as primary signal rather than throwaway metadata.
- Treat mail headers and header-derived fields like `messageId`, `inReplyTo`, `references`, `conversationId`, folder, and mailbox routing as potential signal too.
- Default posture is maximal capture: preserve as much source metadata as practical at ingest time and decide relevance later during analysis.

## Layered Records

- `source_unit`
  - Raw imported unit with normalized participants, timestamps, thread metadata, and original-source pointers.
  - Includes message rows, attachment/document rows, and other source-native units when available.
  - Preserves mail header lineage and header-derived routing/thread fields when present.
- `fact_event`
  - Extracted event or claim grounded in one or more `source_unit` records.
  - Includes recurring contact facts, document/attachment evidence, and document reuse patterns.
  - Now also carries identity/rhythm-oriented events such as cadence, urgency posture, followthrough, correction, context-switch, relationship-rhythm, domain-shift, and narrative-revision patterns.
- `hypothesis`
  - Provisional inferred explanation for why an event happened, who influenced it, or who benefited.
  - Also carries identity-style interpretations such as era-local operating modes, followthrough reliability, relationship intensity, and narrative self-correction.
- `dossier`
  - Human-readable markdown output built only from existing record ids.
  - Includes run-level summaries plus higher-order views like people arcs, influence windows, and political/social-pressure review surfaces.

Every record is append-only and carries:

- `id`
- `recordType`
- `schemaVersion`
- `runId`
- `sourceType`
- `sourceId`
- `occurredAt`
- `timePrecision`
- `actors`
- `topics`
- `confidence`
- `importance`
- `provenance`
- `lineage`

## Time And Provenance

- Time is modeled as a global chronological ledger plus local threads.
- Each record should keep the best-known normalized timestamp and the raw source timestamp fields used to derive it.
- Inferred records must preserve `derivedFrom`, `extractedByStage`, and a chain-of-custody trail back to source ids.

## PST Outputs

`npm run open-memory:pst:corpus -- --run-id <run-id> --units <path> --promoted <path>`

Default output bundle:

- `source-units.jsonl`
- `fact-events.jsonl`
- `hypotheses.jsonl`
- `dossiers.jsonl`
- `dossiers/*.md`
- `manifest.json`
- `corpus.sqlite`

Common dossier outputs now include:

- `overview`
- `decision_timeline`
- `influence_hypotheses`
- `relationship_channels`
- `document_signals`
- `header_signals`
- `people_arcs`
- `person_arc`
- `influence_arcs`
- `influence_windows`
- `pressure_signals`
- `identity_rhythms`
- `identity_shift_points`
- `relationship_rhythm_channels`
- `identity_revision_chains`
- `identity_eras`

The PST runner will now attempt to publish these corpus artifacts alongside the existing continuity and relationship outputs.
The mail importer will also attempt to publish the same canonical corpus bundle from its snapshot output.

Additional source-family runners:

- `npm run open-memory:mail:corpus -- --run-id <run-id> --snapshot <path>`
- `npm run open-memory:twitter:corpus -- --run-id <run-id> --input-dir <twitter-export-data-dir>`
- `npm run open-memory:docs:corpus -- --run-id <run-id> --input <document-metadata-jsonl-or-json>`

Wave-level catalog:

- `npm run open-memory:corpus:catalog -- --root ./output/memory --output ./output/memory/ingest-catalog.json`

## Inference Posture

- Aggressive analysis is allowed.
- Inferred "why" claims must remain `hypothesis` records rather than being merged into `fact_event`.
- Dossiers may summarize boldly, but every statement must resolve back to existing evidence-bearing records.

## Local Interrogation

- Materialize a corpus manifest into SQLite:
  - `npm run open-memory:corpus:sqlite -- --manifest <manifest-path>`
- Query local corpus records:
  - `npm run open-memory:corpus:query -- --db <sqlite-path> --record-type hypothesis --text influence`
- Inspect a record neighborhood with direct evidence links plus shared entities:
  - `npm run open-memory:corpus:query -- --db <sqlite-path> --record-id <record-id> --json`
- Inspect relationship, document, or header clusters by entity label:
  - `npm run open-memory:corpus:query -- --db <sqlite-path> --entity "Micah" --entity-type actor --json`

The SQLite layer now materializes:

- `records`
- `record_edges`
- `record_entities`
- `entity_edges`

Additional entity materialization now includes:

- participant domains
- temporal buckets
- loop states
- time windows
- pattern hints
- topic tokens

That gives the corpus a lightweight local graph surface without turning it back into a runtime-memory-first architecture.

## Legacy Runtime Script Cleanup

- The old high-cost runtime-memory automation and tuning scripts now live under `scripts/legacy/open-memory-runtime/`.
- They are preserved as historical tooling, not as the active architecture.
- Supported active paths remain the corpus exporters/materializers plus the thin Open Memory adapter surfaces such as `open-memory-mcp`, `open-memory-mail-import`, and `open-memory-context-sync`.

## Analyst Context

- Analyst-side context assumptions that should influence interpretation without becoming evidence facts live in `config/analyst-context.assumptions.json`.
- This is the place for standing self-reported context, interpretive guardrails, and other non-evidentiary calibration inputs.
