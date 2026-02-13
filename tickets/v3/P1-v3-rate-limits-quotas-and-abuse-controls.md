# P1: Rate Limits, Quotas, and Abuse Controls

## Goal
Enforce per-actor and per-capability safety limits to prevent runaway automation and connector abuse.

## Non-goals
- No third-party WAF dependency.
- No ML anomaly scoring in this ticket.

## Acceptance Criteria
- Policy layer supports quotas by actor, owner, capability, and time window.
- Denials return stable reason codes and retry-after hints where applicable.
- Staff UI can view and reset counters for emergency operations.
- Limit state is auditable and tamper-evident.

## Files/Dirs
- `functions/src/rateLimits/**`
- `functions/src/agentPolicy/**`
- `web/src/views/StaffView.tsx`
- `studio-brain/src/capabilities/**`

## Tests
- Unit tests for quota evaluation and window rollover.
- Integration tests for 429/blocked behavior across representative endpoints.

## Security Notes
- Counters should be resilient to replay and clock skew.
- Emergency resets require staff role and explicit reason.

## Dependencies
- `P1-v3-agent-identity-bridge-and-delegation-enforcement.md`
- existing v2 rate limit primitives

## Estimate
- Size: M

## Telemetry / Audit Gates
- Emit `rate_limit_triggered` events with actor/capability context.
- Track top limited actors and top limited capabilities weekly.

## Rollback
- Fall back to conservative global rate limits.
- Keep deny-by-default for high-risk capability classes.
