# P2: Finance Reconciliation Swarm (Read-only + Draft Flags)

## Goal
Reconcile Stripe payout/refund signals with portal order/reservation records and flag anomalies.

## Non-goals
- No autonomous refunds/charges.
- No source-of-truth changes in local brain.

## Acceptance Criteria
- Weekly reconciliation summary generated with discrepancy classes.
- Anomalies include evidence pointers and confidence level.
- Staff can convert anomalies into proposals for cloud-authoritative corrections.

## Files/Dirs
- `studio-brain/src/swarm/finance/**` (new)
- `docs/STUDIO_OS_V3_ARCHITECTURE.md`

## Tests
- Unit tests for reconciliation matching logic.
- Edge tests for duplicate events and out-of-order webhook data.

## Security Notes
- Stripe secrets remain cloud-side.
- Local reads use minimum required data.

## Dependencies
- `P0-v3-studio-state-readonly-computation.md`
- `P1-v3-capability-registry-proposal-approval-audit.md`

## Estimate
- Size: L

## Telemetry / Audit Gates
- Reconciliation run emits mismatch counts by class and severity.
- Every generated flag stores source hashes + reconciliation rule id.

## Rollback
- Disable finance reconciliation job.
- Keep existing staff billing/reporting flows.
