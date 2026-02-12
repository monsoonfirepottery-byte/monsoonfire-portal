# S12-03 - Push Lifecycle Spec + Telemetry Contract

Created: 2026-02-10
Sprint: 12
Status: Completed
Swarm: C (Push + Telemetry)

## Problem

Push on mobile is constrained:
- APNs token lifecycle can change at any time.
- Background execution is limited.
- Network is intermittent.

We need a written spec so iOS/Android client behavior matches backend expectations and telemetry is trustworthy.

## Tasks

- Specify client behavior:
  - when to register token (first launch, after permission grant, after token refresh)
  - when to unregister token
  - retry policy when offline
  - how to handle provider invalidation signals
- Specify telemetry writes:
  - required fields in `notificationDeliveryAttempts`
  - mapping from provider errors to `reasonCounts` buckets
- Define alert thresholds and on-call actions that assume mobile client behavior.
- Update runbooks if required:
  - `docs/NOTIFICATION_ONCALL_RUNBOOK.md`

## Acceptance

- iOS and Android implement identical token registration/unregistration semantics.
- Telemetry is consistent enough to support alerting without false positives.

## Progress updates
- Added lifecycle + telemetry contract doc: `docs/MOBILE_PUSH_LIFECYCLE_AND_TELEMETRY.md`.
- Updated on-call runbook to reference lifecycle/retry source-of-truth docs:
  - `docs/NOTIFICATION_ONCALL_RUNBOOK.md`
- Added parity tracking completion item in `docs/MOBILE_PARITY_TODOS.md`.
