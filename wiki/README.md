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

## Loop Guardrails

- Source/chunk refreshes use tombstones and inactive versions instead of hard-deleting prior chunk anchors.
- Contradictions can be `blocked` when current operational truth is known but the losing evidence is owned by a paused edit surface.
- `wiki_idle_task` is the Postgres queue for bounded wiki maintenance; report-only idle runs plan tasks, and apply mode leases ready tasks with `FOR UPDATE SKIP LOCKED`.
- Export drift checks compare deterministic markdown/JSONL renders against git files before agents trust the wiki as a review surface.

## Wiki And Studio Brain Memory

Use Studio Brain memory first for continuity, recent events, open loops, and "what was I doing?" startup recovery. Use this wiki as the compiled, audited context layer after memory has oriented the thread.

The wiki should be quiet enough for startup: verified or operational-truth claims can enter the context pack, while unverified and human-gated claims stay in bounded warning digests and approval snapshots. The full backlog remains inspectable in `00_source_index/`, `50_contradictions/`, and generated `output/wiki/` reports.

## Approval And Outcome Commands

- `npm run wiki:human-gates:snapshot` refreshes the tracked human-gate approval state and snapshot. It has no approval side effects.
- `npm run wiki:human-gates:packets` emits reviewer packets grouped by policy docs, package procedures, and source-of-truth claims. Packet output does not approve or promote claims.
- `npm run wiki:outcome:record -- --classification organic --title "Wiki context pack helped ..." --outcome helpful --notes "..." --source-command "..." --evidence-artifact "..."` records real non-test wiki usage.
- `npm run wiki:outcome:trend` emits the weekly-friendly trend summary for automation.

Record organic outcomes only when the wiki actually changed a future agent's work: faster startup, prevented stale source use, routed a contradiction, or avoided a broad repo read. Mark harness, fixture, and end-to-end verification runs as `test`; do not fabricate organic value to satisfy an audit.
