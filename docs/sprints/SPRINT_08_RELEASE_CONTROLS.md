# Sprint 08 - Release Controls + Reliability

Window: Week 8  
Goal: Productionize notification delivery with retry controls, dead-letter handling, and observable health metrics.

## Ticket S8-01
- Title: Notification retry policy + dead-letter pipeline
- Swarm: `Swarm A`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S7-03
- Deliverables:
  - classified error handling (`auth`, `provider_4xx`, `provider_5xx`, `network`, `unknown`)
  - exponential retry/backoff with max-attempt cap for retryable failures
  - dead-letter write for exhausted/non-retryable failures
- Verification:
1. Retryable failures are re-queued with future `runAfter`.
2. Non-retryable failures move directly to failed + dead-letter.
3. Exhausted retries move to dead-letter with final error metadata.

## Ticket S8-02
- Title: Notification delivery metrics aggregation
- Swarm: `Swarm C`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S7-02
- Deliverables:
  - scheduled 24h aggregate snapshot for delivery attempts
  - status/reason/provider counters persisted in `notificationMetrics/delivery_24h`
  - baseline query contract for operations monitoring
- Verification:
1. Scheduler writes `notificationMetrics/delivery_24h` every run.
2. Aggregates include totals + status/reason/provider breakdowns.
3. Counts track new telemetry events over time.

## Ticket S8-03
- Title: Alert thresholds + on-call runbook
- Swarm: `Swarm D`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S8-02
- Deliverables:
  - alert thresholds for failure rate and invalid-token spikes
  - incident triage runbook for notification outage scenarios
  - escalation matrix and rollback notes
- Verification:
1. Thresholds are documented with actionable response steps.
2. Runbook includes query references and decision tree.
3. Escalation owners are explicit.

## Ticket S8-04
- Title: Relay credential deployment hardening
- Swarm: `Swarm A`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S7-03
- Deliverables:
  - remove runtime deploy blockers from relay credential handling
  - standardize runtime env variable handling (`APNS_RELAY_KEY`) for deploy + emulator
  - update docs with explicit rotation/runbook steps
- Verification:
1. Relay credentials are loaded from runtime env configuration.
2. Rotation steps are documented and tested.
3. Push flow remains functional after key rotation.

## Ticket S8-05
- Title: Release candidate evidence pack
- Swarm: `Swarm D`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S8-01, S8-02
- Deliverables:
  - release checklist output for notification reliability controls
  - CI evidence links and smoke artifacts
  - known-risk register for alpha -> beta promotion gate
- Verification:
1. Evidence includes reliability, metrics, and rollback checks.
2. CI artifacts are linked and reviewable.
3. Risk register has owner + mitigation per item.
