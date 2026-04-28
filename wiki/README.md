# Studio Brain Agent Wiki

This wiki is the human-reviewable export surface for the Postgres-backed Studio Brain knowledge substrate.

Postgres is the hot operational store for source indexes, chunks, claims, pages, contradictions, context packs, and idle tasks. Markdown in this directory is the review, rollback, and rebuild surface. Raw repo files remain the source of truth.

## Directories

- `00_source_index/` - approved source inventory, extracted fact JSONL, and source maps.
- `10_operational_truth/` - human-approved operational truth only.
- `20_concepts/` - synthesized but source-grounded concepts.
- `30_workflows/` - operational workflows and runbooks distilled from sources.
- `40_decisions/` - durable decisions and supersession chains.
- `50_contradictions/` - reviewable conflict records; agents do not silently resolve these.
- `60_deprecated/` - retired or superseded material kept for traceability.
- `70_agent_context_packs/` - compact context packs for Codex and idle agents.
- `80_idle_tasks/` - safe, bounded wiki improvement work packets.
- `90_audits/` - validation, freshness, query-plan, and coverage reports.
- `schemas/` - JSON schemas that define page and export contracts.

## Status Rules

Agents may autonomously create `RAW_CAPTURED`, `EXTRACTED`, `SYNTHESIZED`, `STALE`, `DEPRECATED`, `CONTRADICTORY`, and `NEEDS_HUMAN_REVIEW` records when source evidence supports the transition.

Agents may verify citations and move records to `VERIFIED` only when every factual claim has a resolvable source reference. Agents may not promote material to `OPERATIONAL_TRUTH`; that requires human approval.

Pricing, legal, tax, medical, refund/payment, membership/access, and customer-facing policy changes require human approval before they can be used as operational truth.
