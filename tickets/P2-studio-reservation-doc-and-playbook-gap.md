# P2 — Studio Reservation Operations Documentation & Playbook

Status: Completed
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

## Completion Evidence (2026-02-23)
- Reservation schema doc refreshed with lifecycle graph, queue/ETA semantics, and migration fallback notes:
  - `docs/SCHEMA_RESERVATIONS.md`
- Operational playbook added with:
  - queue triage/cancellation/waitlist rules
  - ETA shift escalation
  - customer expectation copy
  - QA end-to-end run path (intake -> confirm -> delay -> ready reminder -> storage escalation)
  - `docs/runbooks/STUDIO_RESERVATION_OPERATIONS_PLAYBOOK.md`
- Profile planning doc now includes reservation-history + notification-status section:
  - `docs/PLAN_PROFILE.md`
- Release-checklist artifact updated with reservation doc sync requirement:
  - `docs/runbooks/PR_GATE.md`
- Deterministic documentation check added:
  - command: `npm run docs:reservations:check`
  - script: `scripts/check-reservation-doc-sync.mjs`
- Source-of-truth index updated with new runbooks:
  - `docs/SOURCE_OF_TRUTH_INDEX.md`
