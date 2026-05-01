# P1 — Codex startup memory reliability and auth contract

Status: Completed
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

## Completion Notes
- Verified startup reason-code plumbing is present through the startup preflight, doctor, scorecard, shell, MCP launch/server, and Open Memory automation paths.
- Live `codex-startup-preflight` initially reported `degraded` while local startup context repaired from cross-thread fallback, then passed on retry through the validated-local fast path with `reasonCode: ok`, `continuityState: ready`, `threadScopedItemCount: 8`, and no degradation buckets.
- `codex-doctor` passed with startup contract `status: pass`, repo lane alignment, clean `codex/tickets` worktree state, and zero warnings/errors.
- `codex-startup-scorecard` reported grade `A` for the current live sample. Launcher coverage remains provisional at 4/5 live samples, so one more fresh Codex launcher/startup observation should be collected before treating the aggregate scorecard as fully trustworthy.

## Verification
- `node ./scripts/codex-startup-preflight.mjs --json`
- `node ./scripts/codex-doctor.mjs --json`
- `node ./scripts/codex-startup-scorecard.mjs --json`
- `node --test scripts/lib/codex-startup-reliability.test.mjs scripts/lib/codex-startup-telemetry.test.mjs scripts/codex-startup-scorecard.test.mjs scripts/codex-doctor.test.mjs scripts/codex/open-memory-automation.test.mjs`

## Dependencies
- `scripts/codex-shell.mjs`
- `scripts/codex-doctor.mjs`
- `scripts/codex/open-memory-automation.mjs`
- `studio-brain-mcp/launch.mjs`
- `studio-brain-mcp/server.mjs`
- `docs/runbooks/MCP_OPERATIONS.md`
