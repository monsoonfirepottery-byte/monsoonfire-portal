# P1 — Studio Reservations Operations Completeness (Reservations, Queue, Notifications)

Status: Completed
Date: 2026-02-17

## Problem
Reservations currently collect enough intake detail and persist to Firestore, but the operational loop stops at create-on-submission. The repository has status enums and policies for window scheduling and storage handling, but there is no end-to-end reservation operations surface for:

- staff lifecycle updates (confirm/waitlist/cancel),
- queue transparency (position, ETA, SLA state),
- proactive user communication on status/ETA shifts,
- piece-level traceability.

This is highest priority for a working studio workflow, independent of workshop/class/store modules.

## Objective
Create a reliable studio reservation operations loop that supports:

- intake → queue placement → status transitions → customer-visible ETA updates → pickup/storage follow-up.

## Suggested execution

### Epic dependencies
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-reservation-queue-ops-ui.md`
- `tickets/P1-studio-notification-sla-journey.md`
- `tickets/P2-studio-piece-traceability-with-piece-codes.md`
- `tickets/P2-studio-storage-hold-automation.md`
- `tickets/P2-studio-reservation-doc-and-playbook-gap.md`

### Out of scope
- workshop or classroom booking workflows
- store/ecommerce product catalog expansion
- unrelated reporting rewrites

### Completion criteria
- A reservation can move through a defined staff workflow with status and load updates.
- Users can see where they are in that workflow and how likely the next step is.
- Delays or hold actions always result in explicit notifications and visible audit trail.

### Evidence from marketplace scan (non-exhaustive)
- Pottery studio platforms emphasize visible stage updates, pickup reminders, and QR/label workflows.
- Reddit user feedback repeatedly requests better status visibility, reduced communication latency, and less manual follow-up for long firings.

### Recommended backlog expansion (new from latest scan)

- P1 foundations
  - Keep existing `P1` milestones as-is for API + UI + SLA closure.
- P2 runway (studio operations hardening)
  - `tickets/P2-studio-station-aware-routing-and-capacity-controls.md`
    - Enforce station/kiln-aware queue lanes and capacity
    - Reduce overloading risks and clarify lane-specific ETA
  - `tickets/P2-studio-offline-staff-kiosk-workflow-sync.md`
    - Add offline-safe staff ops for inconsistent Wi-Fi/bad coverage
    - Preserve queue action auditability under sync recovery
  - `tickets/P2-studio-arrival-checkin-and-qr-intake.md`
    - Add member-initiated arrival + staff lookup flow
    - Reduce manual touchpoints and improve queue predictability
  - `tickets/P2-studio-pickup-window-booking.md`
    - Close the pickup loop and reduce storage friction
  - `tickets/P2-studio-notification-channel-and-fallback-controls.md`
    - Standardize channel routing and retry/fallback for stage + pickup messages
  - `tickets/P2-studio-data-portability-and-backup-risks.md`
    - Add continuity/restore path and export controls
  - `tickets/P2-studio-storage-hold-automation.md`
    - Tie pickup storage policy to message and no-show policy transitions
  - `tickets/P2-studio-no-show-and-queue-fairness-policy.md`
    - Align capacity fairness with arrival and no-show workflows

### Proposed release slice (short)
1. `P2-studio-arrival-checkin-and-qr-intake.md`
2. `P2-studio-station-aware-routing-and-capacity-controls.md`
3. `P2-studio-offline-staff-kiosk-workflow-sync.md`
4. `P2-studio-notification-channel-and-fallback-controls.md`
5. `P2-studio-data-portability-and-backup-risks.md`

### Tracking
- Owner recommendation: run one ticket design review per slice, then execute with a queue of one.
- Supporting analysis: `docs/STUDIO_OPERATIONS_GAP_MATRIX_2026-02-17.md`

### Completion summary (2026-02-24)
- All scoped dependency tickets are now completed, including:
  - `tickets/P2-studio-notification-channel-and-fallback-controls.md`
  - `tickets/P2-studio-offline-staff-kiosk-workflow-sync.md`
  - `tickets/P2-studio-data-portability-and-backup-risks.md`
- Reservation operations loop now covers:
  - lifecycle/status transitions,
  - queue fairness + pickup-window operations,
  - storage hold/reminder automation,
  - continuity export/recovery procedures,
  - multi-channel notifications with SMS hard-failure email fallback.
