# P1: Ops Anomaly Detector (Draft Recommendations Only)

## Goal
Detect operational anomalies and produce draft recommendations/proposals for staff review.

## Non-goals
- No automatic execution of recommendations.
- No direct mutation of authoritative cloud records.

## Acceptance Criteria
- Rule set identifies baseline anomalies (stalled batches, queue spikes, overdue reservations).
- Detector outputs recommendation drafts with severity and rationale.
- Recommendations can optionally map to proposal records, not direct actions.
- Alerts are throttled to avoid staff fatigue.

## Files/Dirs
- `studio-brain/src/swarm/ops/**` (new)
- `studio-brain/src/studioState/**`

## Tests
- Unit tests for detection thresholds and throttling.
- Regression tests for false-positive suppression logic.

## Security Notes
- Recommendations are non-executing artifacts.
- Audit every detector run and recommendation creation.

## Dependencies
- `P0-v3-studio-state-readonly-computation.md`
- `P1-v3-capability-registry-proposal-approval-audit.md` (for proposal mapping path)

## Estimate
- Size: M

## Telemetry / Audit Gates
- Detector run summary: rule hit counts, suppressed alerts, emitted recommendations.
- Recommendation lifecycle events and human disposition metrics.

## Rollback
- Disable detector scheduled job.
- Continue with manual staff operations.
