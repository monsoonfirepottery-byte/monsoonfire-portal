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

## Cloudflare Notes
- Use managed MCP endpoints with `/mcp` only.
- Do not use `/sse` (deprecated in Cloudflare managed MCP catalog).
- Codex OAuth regression note: in `codex-cli 0.104.0`,
  `codex mcp login cloudflare_docs` may fail with
  `No authorization support detected` (tracked behavior: #11465).
- `cloudflare_browser_rendering` may still support login prompts.
- If profile activation is flaky (#9325 pattern), keep using wrapper overrides.
