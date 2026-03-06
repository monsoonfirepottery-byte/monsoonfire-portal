# Legacy Open Memory Runtime Archive

This repo used to carry a larger runtime-memory operations stack focused on supervising, tuning, and backfilling an always-on Open Memory environment.

That is no longer the primary architecture.

The active direction is:

- build a canonical evidence corpus
- preserve provenance and chain of custody
- mine for decisions, influence, people arcs, and pressure signals
- treat any runtime memory system as an adapter target rather than the source of truth

Archived scripts now live in:

- `scripts/legacy/open-memory-runtime/`
- `scripts/legacy/codex/`

These archived scripts are intentionally not part of the default command surface. They remain available only for historical reference or one-off recovery work.

Examples of archived runtime tooling:

- ops supervisors and systemd bundles
- DB audit/autotune/remediation loops
- experimental context indexing/capture flows
- ingest guards and contention probes
- backfill/autonomous/autopilot loops

Active supported surfaces are the corpus-first tools:

- `npm run open-memory:pst:corpus`
- `npm run open-memory:mail:corpus`
- `npm run open-memory:corpus:sqlite`
- `npm run open-memory:corpus:query`

Adapter-oriented surfaces that still remain active:

- `npm run open-memory -- stats`
- `npm run open-memory:mcp`
- `npm run open-memory:context:sync`
- `npm run open-memory:mail:import`
