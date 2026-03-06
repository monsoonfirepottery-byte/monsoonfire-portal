# Open Memory Adapter Runbook

## Status

This repo no longer treats the old Open Memory runtime stack, supervisor, experimental context indexers, or autonomous ops loops as the primary memory architecture.

The primary durable path is now the canonical corpus:

```bash
npm run open-memory:pst:corpus -- --run-id <id> --units <path> --promoted <path>
npm run open-memory:mail:corpus -- --run-id <id> --snapshot <path>
npm run open-memory:corpus:sqlite -- --manifest <path>
npm run open-memory:corpus:query -- --db <path> --record-type hypothesis --text <term>
```

Reference:
- `docs/CANONICAL_MEMORY_CORPUS.md`

## What still matters here

Open Memory and Studio Brain remain useful as optional downstream adapters and lookup surfaces.

Still-supported repo-facing commands:

```bash
npm run open-memory -- stats
npm run open-memory:mcp
npm run open-memory:mcp:launch
npm run open-memory:context:slice
npm run open-memory:context:sync
npm run open-memory:context:sync:resumable
```

Use these when you explicitly need:
- an MCP lookup surface over imported memory
- a bounded startup context slice for Codex shell bootstrap
- adapter-side health checks while corpus exports remain the source of truth

## Legacy runtime note

Older docs, scripts, and output paths may still mention:
- `open-memory:ops:*`
- `open-memory:context:index:experimental*`
- `memory-guard`
- `memory-supervisor`
- stack up/down, db autotune, pgvector enablement, or autonomous recovery loops

Those flows are no longer advertised in `package.json` as standard operator paths. Treat them as legacy/manual maintenance only, not the expected daily workflow for this repo.

## Minimal health checks

If you need to confirm the adapter surface is alive without invoking old high-cost loops:

```bash
npm run open-memory -- stats
node ./scripts/open-memory.mjs preflight-auth
```

If you need a context artifact for a shell or review task:

```bash
npm run open-memory:context:slice
npm run open-memory:context:sync
```

## Artifact posture

Prefer corpus artifacts and manifests for durable analysis:
- `output/open-memory/corpus/`
- manifest JSON emitted by corpus exporters
- SQLite materializations built from those manifests

Treat adapter-side state as disposable or reconstructable unless a workflow explicitly requires it.

## Intentional non-cleanup

This runbook does not delete legacy runtime scripts from disk. They may still exist for:
- historical reference
- manual migration support
- one-off maintenance by an informed operator

If we later remove those files entirely, do it as a separate cleanup pass with a script-by-script review.
