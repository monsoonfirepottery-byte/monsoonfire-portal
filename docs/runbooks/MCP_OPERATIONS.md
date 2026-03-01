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

## Codex Doctor
Run a bundled harness health check (CLI resolution, docs drift, MCP audit, local memory layout, and ephemeral artifact guard):

```bash
npm run codex:doctor
```

Use strict mode when you want warnings to fail:

```bash
npm run codex:doctor:strict
```

## Local Memory Pipeline (Ignored Workspace)
For local-only `memory/proposed -> memory/accepted` flow inside this repo:

```bash
npm run codex:memory:init
npm run codex:memory:status
npm run codex:memory:propose -- --statement "..."
npm run codex:memory:accept -- --id <memory-id>
```

This workspace is intentionally git-ignored (`memory/`, `*.jsonl`).

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
