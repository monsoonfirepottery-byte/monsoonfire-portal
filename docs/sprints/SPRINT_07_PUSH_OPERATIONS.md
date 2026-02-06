# Sprint 07 - Push Operations + Token Lifecycle

Window: Week 7  
Goal: Harden push readiness with token lifecycle controls, delivery telemetry, and provider integration runway.

## Ticket S7-01
- Title: Device token lifecycle hardening (register + unregister + stale cleanup)
- Swarm: `Swarm A`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S6-01, S6-02
- Deliverables:
  - backend unregister endpoint for device token deactivation
  - stale token scheduled cleanup (90-day inactivity)
  - token document lifecycle fields (`active`, `lastSeenAt`, `deactivatedAt`)
- Verification:
1. Authenticated unregister deactivates token for calling user.
2. Register marks token active and refreshes lifecycle timestamps.
3. Scheduled cleanup deactivates stale tokens and logs count.

## Ticket S7-02
- Title: Push attempt telemetry baseline
- Swarm: `Swarm C`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S6-03
- Deliverables:
  - push attempt telemetry documents for queued notifications
  - reason codes for no-token and provider-not-configured paths
  - correlation fields (uid, dedupeKey, firingId, tokenHashes)
- Verification:
1. Push-enabled preference creates telemetry record per notification job.
2. No-token path logs `NO_ACTIVE_DEVICE_TOKENS`.
3. Provider send path logs `PUSH_PROVIDER_SENT` or `PUSH_PROVIDER_PARTIAL`.

## Ticket S7-03
- Title: APNs provider adapter implementation
- Swarm: `Swarm C`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S7-02
- Deliverables:
  - APNs provider integration (credential + send path)
  - token invalidation on provider reject responses
  - delivery success/failure telemetry updates
- Verification:
1. Valid token send returns provider success and records `sent`.
2. Invalid token response deactivates token with reason code.
3. Provider failures are surfaced with retry-safe status.

## Ticket S7-04
- Title: iOS token lifecycle controls in shell
- Swarm: `Swarm B`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S7-01
- Deliverables:
  - iOS shell unregister token action
  - status messaging for unregister success/failure
  - parity contract wiring for unregister endpoint
- Verification:
1. Unregister action clears local token state after server success.
2. Unregister failures are logged to handler error log.
3. Action is gated by sign-in and network availability.

## Ticket S7-05
- Title: Push operations runbook + contract docs
- Swarm: `Swarm D`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S7-01, S7-02
- Deliverables:
  - API contract doc updates for unregister + telemetry semantics
  - runbook verification updates for token lifecycle actions
  - sprint board linkage for operational tracking
- Verification:
1. Docs include request/response contracts and lifecycle behavior.
2. Verification checklist includes register/unregister + callback checks.
3. Swarm board reflects sprint ownership and ticket states.
