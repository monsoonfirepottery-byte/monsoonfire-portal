# Sprint 09 - Stabilization Drills + Evidence Closure

Window: Week 9  
Goal: Execute reliability drills, lock alert baselines, and close release evidence with reproducible operations steps.

## Ticket S9-01
- Title: Push failure-class drill execution
- Swarm: `Swarm A`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S8-01
- Deliverables:
  - drill procedure for `auth`, `provider_4xx`, `provider_5xx`, `network`
  - expected retry/dead-letter outcomes per class
  - verification capture template for results
- Verification:
1. Each failure class has explicit trigger and expected backend behavior.
2. Retryable classes show queued retry progression.
3. Non-retryable classes show immediate failed + dead-letter behavior.

## Ticket S9-02
- Title: Metrics + alert baseline finalization
- Swarm: `Swarm C`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S8-02
- Deliverables:
  - staff-gated on-demand aggregate endpoint for rapid drill loops
  - alert baseline values documented in on-call runbook
  - dashboard query references for status/reason/provider counts
- Verification:
1. Manual endpoint writes `notificationMetrics/delivery_24h`.
2. Alert thresholds are documented and actionable.
3. Drill loop can run without waiting for scheduler cadence.

## Ticket S9-03
- Title: Secret rotation evidence
- Swarm: `Swarm A`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S8-04
- Deliverables:
  - explicit relay secret rotation procedure
  - validation checks before/after rotation
  - evidence checklist updates
- Verification:
1. Procedure includes rollback-safe sequencing.
2. Validation checks confirm no prolonged outage.
3. Evidence pack contains rotation record fields.

## Ticket S9-04
- Title: Release evidence pack closure
- Swarm: `Swarm D`
- Owner: Codex
- State: `ready_for_verification`
- Dependencies: S8-05
- Deliverables:
  - complete evidence checklists for reliability + ops
  - links/locations for CI, metrics, and dead-letter checks
  - residual risk register template
- Verification:
1. Evidence document has all required sections populated as checklist.
2. Operational links/paths are explicit.
3. Residual risks have owner and mitigation placeholders.
