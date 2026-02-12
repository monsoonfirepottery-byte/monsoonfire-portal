# P2 — Agent Integrations: Abuse Controls + Observability

Status: In Progress

## Problem
- Adding machine-facing endpoints increases attack surface:
  - credential stuffing / token guessing
  - brute-force on PAT tokenId
  - request floods
  - noisy clients burning quota
  - difficult-to-debug failures without telemetry
- Today we have rate limiting primitives (`functions/src/shared.ts`) but we need “agent-grade” observability.

## Goals
- Stronger defenses for PAT auth + agent endpoints.
- Make issues diagnosable without leaking secrets.

## Non-goals
- Full SIEM integration (defer).

## Controls to implement
### 1) Rate limiting (already available, ensure coverage)
- Apply `enforceRateLimit` to:
  - PAT auth failures
  - token creation/list/revoke
  - events.feed
  - agentRequests.create
- Return `429` with `code: RATE_LIMITED` and `retryAfterMs`.

### 2) Token hardening
- PAT token parsing should fail closed.
- Do constant-time compare for secret hash.
- Do not reveal whether `tokenId` exists (generic auth failure message).
- Optional: lockout bucket for repeated failures per ipHash.

### 3) Structured audit logs
Collection: `securityAudit/{eventId}`
- `at`
- `type`
- `uid?: string`
- `mode?: "firebase"|"pat"`
- `tokenId?: string`
- `ipHash?: string`
- `ua?: string`
- `requestId?: string`
- `path?: string`
- `outcome: "ok"|"deny"|"error"`
- `code?: string`

Never store:
- bearer tokens
- secrets
- full IP addresses

### 4) Minimal metrics snapshot (optional)
- Scheduled job writes 24h aggregates:
  - total agent requests
  - auth failures
  - rate limited counts
  - webhooks sent/failed (if enabled)
Collection: `securityMetrics/daily`

### 5) Portal troubleshooting panel (optional)
- In dev/staff mode, show last requestId and error code/message for agent endpoints.

## Tasks
1. Add `logSecurityEvent(...)` helper in `functions/src/shared.ts` or `functions/src/securityAudit.ts`.
2. Instrument:
  - PAT auth successes/failures
  - v1 handler entry/exit
  - events.feed
  - agentRequests endpoints
3. Add rate limits to any new endpoints added for agent integrations.
4. Add a scheduled aggregation (optional).
5. Document operational playbook: “if auth failures spike, rotate pepper/revoke tokens”.

## Acceptance
- Agent endpoints are rate-limited and return consistent `RATE_LIMITED` responses.
- Security audit data is present and does not contain secrets.
- A staff member can diagnose common failure modes (bad token, missing scope, rate limited) from logs + requestId.

## Progress notes
- Staff Agent Ops now enforces confirmation and explicit reason capture for high-impact actions (rotate/suspend/revoke), improving audit quality and reducing accidental misuse.
- Denied-event analytics in Agent Ops now respect date-window filters in UI and exports for faster incident scoping.
- Added best-effort `securityAudit` logging in auth middleware for PAT/delegated auth success and deny paths (no token secrets or raw IPs stored).
