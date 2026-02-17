# P2 — No-Show and Queue Fairness Policy

Status: Open
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
