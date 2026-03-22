# P1 — Codex startup memory reliability and auth contract

Status: Active
Date: 2026-03-21
Priority: P1
Owner: Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-codex-efficiency-and-startup-reliability.md

## Problem
Codex startup continuity has been failing with vague messages, which forces broad repo rediscovery and wastes operator time.

## Tasks
1. Normalize startup failures into stable reason codes:
   - `missing_token`
   - `expired_token`
   - `transport_unreachable`
   - `timeout`
   - `empty_context`
2. Surface those codes in `scripts/codex-shell.mjs`, `studio-brain-mcp/launch.mjs`, `studio-brain-mcp/server.mjs`, and `npm run codex:doctor`.
3. Add a one-shot startup preflight covering Studio Brain reachability, MCP bridge reachability, token presence/freshness, and startup latency budgets.
4. Document the one-unblock-step recovery contract before retrying the same `query + runId`.

## Acceptance Criteria
1. Codex shell prints exact startup reason codes when continuity is unavailable.
2. `npm run codex:doctor` includes startup preflight results.
3. Startup diagnostics distinguish auth, transport, timeout, and empty-context failures.

## Dependencies
- `scripts/codex-shell.mjs`
- `scripts/codex-doctor.mjs`
- `scripts/codex/open-memory-automation.mjs`
- `studio-brain-mcp/launch.mjs`
- `studio-brain-mcp/server.mjs`
- `docs/runbooks/MCP_OPERATIONS.md`
