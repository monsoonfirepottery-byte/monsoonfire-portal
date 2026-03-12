# MCP Operations Runbook

## Purpose
Keep Codex MCP usage lean, explicit, and predictable in daily operator workflows.

## Default Disabled Model
- Top-level MCP server blocks in `~/.codex/config.toml` stay `enabled = false`.
- Profiles declare intent.
- Runtime wrappers force profile servers on via CLI overrides to avoid profile activation flakiness.

## Wrapper Usage
Use `scripts/codex-mcp.sh` from repo root:

```bash
./scripts/codex-mcp.sh list
./scripts/codex-mcp.sh docs
./scripts/codex-mcp.sh infra
./scripts/codex-mcp.sh home
./scripts/codex-mcp.sh apple
./scripts/codex-mcp.sh cloudflare
./scripts/codex-mcp.sh memory
./scripts/codex-mcp.sh context
./scripts/codex-mcp.sh shell
./scripts/codex-mcp.sh resume
./scripts/codex-mcp.sh resume-fresh
./scripts/codex-mcp.sh resume-status
```

Use `scripts/codex-shell.mjs` (or `npm run codex:shell`) for a memory + context bootstrapped Codex shell session:

```bash
node ./scripts/codex-shell.mjs
npm run codex:shell
npm run codex:resume
npm run codex:resume:fresh
npm run codex:resume:status

# Optional: provide a focused session query and stable run id
node ./scripts/codex-shell.mjs --query "continue yesterday's coding context" --run-id my-shell-123

# Optional: tune relationship-aware continuity recovery
node ./scripts/codex-shell.mjs --query "open loops with team threads" --expand-relationships=true --max-hops 3
node ./scripts/codex-shell.mjs --query "handoff state" --expand-relationships --max-hops 3

# Optional: always inject local context from a file
node ./scripts/codex-shell.mjs --context-path output/codex-shell-context.md --context-max-chars 2400
```

You can also set defaults globally by exporting:

```bash
export CODEX_OPEN_MEMORY_BOOTSTRAP_QUERY="who are we and what are our active handoff tasks"
export CODEX_OPEN_MEMORY_EXPAND_RELATIONSHIPS=true
export CODEX_OPEN_MEMORY_MAX_HOPS=3
export CODEX_OPEN_MEMORY_RUN_ID="shell-session-<timestamp or worker-id>"
export CODEX_OPEN_MEMORY_REUSE_LAST_RUN_ID=true
export CODEX_OPEN_MEMORY_SESSION_TTL_MS=43200000
export CODEX_OPEN_MEMORY_SESSION_STATE_PATH=output/codex-shell-state.json
export CODEX_SHELL_CONTEXT_PATH=output/codex-shell-context.md
export CODEX_SHELL_CONTEXT_MAX_CHARS=2400
export CODEX_SHELL_CONTEXT_BOOTSTRAP=true
export CODEX_ENABLE_CONTEXT7_ON_SHELL=true
```

If you prefer MCP operations wrapper form:

```bash
./scripts/codex-mcp.sh shell
./scripts/codex-mcp.sh shell --query "resume yesterday" --run-id my-shell-123
./scripts/codex-mcp.sh shell --query "handoff state" --expand-relationships=true --max-hops 3
./scripts/codex-mcp.sh resume
./scripts/codex-mcp.sh resume --query "handoff state" --expand-relationships=true --max-hops 3
./scripts/codex-mcp.sh resume-fresh
./scripts/codex-mcp.sh resume-status
```

### Restart and handoff flow

`shell` is explicit and always passes through your current env flags.

For the default handoff loop, launch with:

```bash
./scripts/codex-mcp.sh resume
```

This command forces run reuse defaults (`CODEX_OPEN_MEMORY_REUSE_LAST_RUN_ID=true`) so the launcher
pulls the previous run ID/query from `CODEX_OPEN_MEMORY_SESSION_STATE_PATH` when available.

Equivalent npm command:

```bash
npm run codex:resume
npm run codex:resume:fresh
npm run codex:resume:status
npm run codex:resume:install
```

For manual continuity with no implicit reuse, use `shell` with args:

```bash
./scripts/codex-mcp.sh shell --query "resume yesterday" --run-id my-shell-123
```

For a guaranteed clean shell (no bootstrap + no run reuse), use:

```bash
./scripts/codex-mcp.sh resume-fresh
```

For quick continuity-state inspection:

```bash
./scripts/codex-mcp.sh resume-status
```

### One-word command (global)

Install once and use `codexr` from any directory:

```bash
npm run codex:resume:install
codexr
```

`codexr` is a tiny launcher that resolves to `./scripts/codex-mcp.sh resume` in this repository:

```bash
codexr --query "continue from latest unresolved item"
```

If `CODEX_OPEN_MEMORY_REUSE_LAST_RUN_ID` is enabled (and the persisted session state is within `CODEX_OPEN_MEMORY_SESSION_TTL_MS`), `shell` will reuse:
- the last successful `runId`
- the last bootstrap query

Use this when you need to continue across shell restarts without manually supplying query/run id.

State inspection:

```bash
cat output/codex-shell-state.json
```

Useful fields to watch:
- `runId` / `lastRunId`
- `query`
- `querySource`
- `contextPath`
- `contextSummary`
- `contextSource`
- `status` / `exitStatus`

To force a clean context when useful:

```bash
./scripts/codex-mcp.sh shell --no-bootstrap
```

What it does:
- Uses the global PATH `codex` binary by default (repo-local binary is fallback only).
- Runs `codex --profile <profile> -c 'mcp_servers.<id>.enabled=true' ... mcp list`
- Includes read-only smoke checks for `docs` and `cloudflare`

## Config Regression Audit
Run this before merges or after MCP edits:

```bash
npm run audit:codex-mcp
```

Audit guarantees:
- Canonical MCP keys only (from `docs/SOURCE_OF_TRUTH_INDEX.md` section 3)
- Top-level MCP servers are disabled
- Profile MCP blocks only set `enabled = true`
- No deprecated `/sse` endpoints
- Cloudflare managed URLs end with `/mcp`
- No deprecated Codex model config blocks (`[model_providers.*]` / `[models.*]`)

## Codex Docs Drift Check
Run this to detect stale explicit Codex CLI version references in active MCP harness docs/scripts:

```bash
npm run codex:docs:drift
```

Use strict mode in CI-sensitive flows:

```bash
npm run codex:docs:drift:strict
```

If a Codex command fails with workspace/branch-level errors (for example `git checkout` runtime errors from dirty worktree conflicts), pause before retrying:

- Capture failure class + command context (`git status --short`, active branch, command being retried).
- Resolve local state (`commit`, `stash`, or intentional rerun with `--allow-dirty`).
- Rerun with a changed strategy (narrowed scope, `--dry-run`, or `--json`) instead of repeating the same command verbatim.

### Codex interaction cooldown and status-block recovery

When using `npm run codex:interaction:apply` or `npm run codex:interaction:daily`:

- If output status is `skipped` for duplicate run-id, keep that run blocked, record blocker evidence (`command`, `runId`, reason), and rerun only after changing strategy (`--run-id`, next AM/PM cadence, or explicit task shift).
- If output status is `structural edit cooldown active`, do not rerun the same command signature. Record the blocker and one concrete unblock action for the next execution window.
- If output error is workspace-level refusal (for example `Refusing --apply run on dirty worktree`), treat it as a single workspace-block signature: record blocker evidence (`command`, `runId`, `first signal`), then run exactly one unblock action (cleanup/commit/stash, or one `--allow-dirty` retry) before any broader retry.
- If output status is `applied` but `structuralDecision.mode: Defer` (no `.codex/user.md` or `.codex/agents.md` edits), treat as a signal-only pass:
  - log trigger IDs and reason in the interaction blocker log,
  - capture the exact unblock action (usually `next AM/PM`),
  - do not apply additional scoped retries in the same run window.
- If startup-memory context returns `missing-auth-token` (or transport/timeout errors while bootstrap is attempted), recover with the exact task `query` + `runId` before continuing run-context-dependent commands. Use bounded relationship hops to avoid repeated-context ambiguity:

```bash
npm run open-memory -- context --agent-id agent:codex --query "<task query>" --run-id "<run-id>" --expand-relationships=true --max-hops 3
```

If the CLI context path is blocked by auth (`missing-auth-token`), use this structured fallback after logging the blocker signature:

```bash
mcp__open_memory__startup_memory_context --query "<task query>" --runId "<run-id>" --expandRelationships true --max-hops 3
```

- If startup recovery returns no context rows, continue only with explicit scoped tasks and do not infer prior behavior from the empty payload; log `startup-no-context` with:
  - `command`
  - `runId`
  - `query`
  - `error-class`
  - `exit-code`
- If startup recovery fails with CLI transport fallback class `context-cli-fallback-failed` and `spawnSync ... ETIMEDOUT`, treat this as a hard blocked startup state and pause unchanged signatures until one unblock action is complete:
  - `--run-id` shift,
  - AM/PM defer,
  - or explicit startup context recovery with the same query/runId after one environment/credential unblock step.
- If startup recovery fails repeatedly with the same `(query + runId)` pair, treat the run as blocked and pause all additional interaction retries until one unblock action is recorded.

```bash
# unblock a blocked interaction run by changing intent/run id
# Use a different run-id suffix for each retry of the same blocker signature.
npm run codex:interaction:apply -- --run-id codex-interaction-interrogation-v1::propose-instruction-updates::2 --allow-dirty --force --json
```

If the same startup/bootstrap sequence is failing repeatedly:

- stop rerunning identical command signatures,
- record the blocker with command + exit + first signal line,
- take one minimal unblock action (`--run-id` shift, AM/PM defer, or auth-path repair),
- and resume only after that action is logged.
- For unchanged `(query + runId)` bootstrap failures (including repeated `missing-auth-token` or transport error signatures), treat as blocked state and pause any additional interaction signatures until one unblock action is executed.

For this task family, use bounded startup recovery on the first retry:

```bash
npm run open-memory -- context --agent-id agent:codex --query "codex-interaction-interrogation-v1 codex-interaction-interrogation-v1::propose-instruction-updates Propose structural instruction updates with bounded scope codex-docs-only medium" --run-id "codex-interaction-interrogation-v1::propose-instruction-updates" --expand-relationships=true --max-hops 3
```

Then run:

```bash
npm run codex:docs:drift:strict
npm run codex:doctor:strict
```

## Codex Doctor
Run a bundled harness health check (CLI resolution, docs drift, MCP audit, local memory layout, and ephemeral artifact guard):

```bash
npm run codex:doctor
```

Use strict mode when you want warnings to fail:

```bash
npm run codex:doctor:strict
```

Open Memory primary health probe:

```bash
npm run open-memory -- stats
```

## Codex Agentic Rubric + Autopilot
Run Codex performance rubric, telemetry random audit, and backlog autopilot loops:

```bash
npm run codex:rubric:daily
npm run codex:telemetry:audit
npm run codex:backlog:autopilot
```

Strict trust-but-verify lane:

```bash
npm run codex:rubric:strict
npm run codex:telemetry:audit:strict
```

Artifact-emitting lane:

```bash
npm run codex:rubric:daily:write
npm run codex:telemetry:audit:write
node ./scripts/codex/backlog-autopilot.mjs --dry-run --write --json
```

Runbook: `docs/runbooks/CODEX_AGENTIC_RUBRIC_AND_AUTOPILOT.md`

## Local Memory Pipeline (Fallback / Ignored Workspace)
For local fallback `memory/proposed -> memory/accepted` flow inside this repo:

```bash
npm run codex:memory:init
npm run codex:memory:status
npm run codex:memory:propose -- --statement "..."
npm run codex:memory:accept -- --id <memory-id>
```

This workspace is intentionally git-ignored (`memory/`, `*.jsonl`).

## Open Memory MCP Bridge
For Studio Brain-backed agent memory tools over stdio MCP:

```bash
npm run open-memory:mcp
npm run open-memory:mcp:launch
```

Auth note:
- `open-memory:mcp:launch` reads `secrets/studio-brain/studio-brain-automation.env`.
- It also reads `secrets/portal/portal-automation.env` and mints a fresh staff Firebase ID token by default.
- Set `STUDIO_BRAIN_PREFER_EXISTING_AUTH_TOKEN=true` to keep an existing auth token instead of reminting.

Tools exposed:
- `capture_thought`
- `search_memory`
- `list_recent_memories`
- `memory_stats`
- `import_memories`

See also: `docs/runbooks/OPEN_MEMORY_SYSTEM.md`.

## Open Memory Context Sync
Use context sync only as an optional downstream adapter path. The primary durable memory workflow is now the canonical corpus described in `docs/CANONICAL_MEMORY_CORPUS.md`.

Context sync is still useful when agents need a bounded startup bundle derived from intent, tickets, docs, GitHub, and MCP summaries without overloading context:

```bash
npm run open-memory:context:slice
npm run open-memory:context:sync
```

Notes:
- Treat the generated slice as a bootstrap artifact, not the source of truth.
- Prefer corpus export plus SQLite/query flows for durable ingestion and later import.
- Scheduled lane: `.github/workflows/open-memory-context-sync.yml`.

## Codex CLI 0.106+ Notes
- Legacy `model_providers` and `models` table blocks are deprecated in `~/.codex/config.toml`.
- Preferred shape is top-level `model` and optional `model_provider`.
- If you still have legacy blocks, migrate once with `codex -m <model-id>` (for example `codex -m gpt-5`).

## Cloudflare Notes
- Use managed MCP endpoints with `/mcp` only.
- Do not use `/sse` (deprecated in Cloudflare managed MCP catalog).
- `cloudflare_docs` may still report unsupported auth capability in current Codex CLI builds;
  when that happens, `codex mcp login cloudflare_docs` can return
  `No authorization support detected`.
- `cloudflare_browser_rendering` may still support login prompts.
- If profile activation is flaky (#9325 pattern), keep using wrapper overrides.

## Interaction Run Hard-Pause Rule

- For unchanged `(query + runId)` where both startup context recovery paths fail
  (CLI and MCP tool), classify the state as blocked immediately.
- Record one blocker entry (`command`, `exit`, `first signal`, `query`, `runId`) before any strategy switch.
- Do not rerun any interaction command signatures for that pair until one unblock action is executed:
  - `--run-id` shift,
  - AM/PM window defer,
  - auth/token-path repair.
- In codex-docs-only runs, keep interaction attempts paused until evidence + unblock are complete.
