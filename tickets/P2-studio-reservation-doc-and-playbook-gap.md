# P2 — Studio Reservation Operations Documentation & Playbook

Status: Open
Date: 2026-02-17

## Problem
Multiple docs mention scheduling windows, access windows, and storage policy, but there is no single, concrete operations reference showing reservation lifecycle semantics, queue expectations, and staff handoff criteria.

This creates uneven behavior:
- users do not always receive consistent messaging,
- staff decisions are inconsistent across channels,
- analytics/policy audits become harder.

## Scope
- `docs/SCHEMA_RESERVATIONS.md`
- `docs/policies/firing-scheduling.md`
- `docs/policies/storage-abandoned-work.md`
- `docs/policies/studio-access.md`
- `docs/PLAN_PROFILE.md`
- `docs/SCHEMA_PROFILE.md`
- `tickets` board metadata

## Tasks
1. Create/refresh `docs/SCHEMA_RESERVATIONS.md` with:
   - explicit status lifecycle graph,
   - field-level contract for any new reservation metadata,
   - canonical API list (`createReservation`, `updateReservation`, list/read paths).
2. Add operational playbook for staff:
   - queue triage, cancellation policy, and waitlist rules,
   - escalation if ETA shifts,
   - handoff and pickup confirmation workflow.
3. Add customer-facing expectations section:
   - what to expect after submission,
   - when notifications are sent,
   - when storage notices occur.
4. Update `docs/PLAN_PROFILE.md` with a reservation-history and notification status section.
5. Add documentation checks to one CI or release checklist artifact:
   - each new reservation field requires docs update.
6. Include a short migration note:
   - if existing reservations predate new fields, explain fallback behavior.

## Acceptance
- Every staff and client-facing status message has a corresponding doc/source of truth.
- New reservation metadata fields do not ship without docs updates in the same release.
- QA can execute one runbook path end-to-end for:
  - intake,
  - confirm,
  - delay update,
  - ready-for-pickup reminder,
  - storage escalation.

## Dependencies
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-notification-sla-journey.md`
- `tickets/P2-studio-storage-hold-automation.md`

