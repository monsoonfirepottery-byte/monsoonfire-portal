# P2 — No-Show and Queue Fairness Policy

Status: Completed
Date: 2026-02-17

## Problem
Queue fairness degrades when no-shows, late arrivals, and recurring delays are handled inconsistently, and there is no codified policy.

## Objective
Introduce policy-driven fairness controls that reduce congestion, reduce repeated late pickups, and make queue outcomes explainable.

## Scope
- `web/src/views/KilnLaunchView.tsx`
- `web/src/views/ReservationsView.tsx`
- `functions/src`
- `docs/policies/firing-scheduling.md`
- `docs/policies/studio-access.md`
- `tickets/P1-studio-queue-position-and-eta-band.md`

## Tasks
1. Define a no-show policy model:
   - late threshold, grace period, and reschedule attempts
   - repeated no-shows impact on queue priority.
2. Implement deterministic queue score modifiers:
   - prioritize confirmed, on-time items and apply penalties for repeated misses.
3. Add staff override controls:
   - manual exception reason, temporary priority boost for urgent work.
4. Add reporting view:
   - queue fairness metrics (late arrivals, hold escalations, repeat offenders)
   - per-day audit log links.
5. Update policy docs and support playbook messaging.

## Acceptance
- queue position changes from policy are predictable and visible.
- no-show penalties are applied only with audit evidence and staff note.
- fairness controls reduce repeated disruptions and are available in staff UI.
- policy is documented and referenced in support runbook.

## Dependencies
- `tickets/P1-studio-queue-position-and-eta-band.md`
- `tickets/P1-studio-reservation-stage-timeline-and-audit.md`

## Completion Evidence (2026-02-24)
- Policy-backed fairness controls shipped in API:
  - new route `apiV1/v1/reservations.queueFairness` with actions:
    - `record_no_show`
    - `record_late_arrival`
    - `set_override_boost`
    - `clear_override`
  - requires staff/dev admin auth and reservation authz
  - writes fairness evidence rows to `reservationQueueFairnessAudit`
  - recomputes queue hints after fairness updates
  - file: `functions/src/apiV1.ts`
- Deterministic queue scoring now uses computed fairness policy:
  - `queueFairnessPolicy.effectivePenaltyPoints` participates in station queue ordering
  - policy version + reason codes persisted per reservation
  - file: `functions/src/apiV1.ts`
- Staff portal fairness controls added:
  - per-reservation no-show / late-arrival recording
  - override boost with optional expiry
  - fairness reason required for each action
  - fairness summary strip and audit collection pointer in staff queue view
  - files: `web/src/views/ReservationsView.tsx`, `web/src/views/ReservationsView.css`
- Client normalization + contract surfaces updated:
  - queue fairness request/response contracts
  - portal API method for fairness route
  - reservation normalizer supports `queueFairness` and `queueFairnessPolicy`
  - files: `web/src/api/portalContracts.ts`, `web/src/api/portalApi.ts`, `web/src/lib/normalizers/reservations.ts`
- Docs + runbook updated to reflect policy and operations:
  - files: `docs/SCHEMA_RESERVATIONS.md`, `docs/policies/firing-scheduling.md`, `docs/policies/studio-access.md`, `docs/runbooks/STUDIO_RESERVATION_OPERATIONS_PLAYBOOK.md`
- Validation coverage added:
  - fairness mutation and override behavior tests
  - staff-admin auth enforcement + audit deny test
  - file: `functions/src/apiV1.test.ts`
