Status: Open
Priority: P1
Labels: security, v2-agentic, functions

## Title
Agent abuse throttling + velocity controls hardening

## Problem statement
Agent routes need robust abuse protections across token modes to prevent scraping and spend abuse.

## Scope
- Validate route + actor keyed rate limits.
- Verify cooldown behavior for repeated denials.
- Add tests for replay-like high-frequency calls.

## Acceptance criteria
- Route-level and actor-level limits are enforced in API v1.
- Retry-after values are emitted on 429.
- Cooldown behavior is observable in logs.

## Implementation notes
- Keep limits configurable by env/config for future tuning.

## Test plan
- Unit tests for window logic.
- Integration smoke test for repeated API calls in emulator.

## Security notes
- Prevent account lockout abuse by keeping cooldown scoped to offending client.
- Preserve audit trail for all automatic suspensions.
