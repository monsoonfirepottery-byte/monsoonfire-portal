# Studio Operations Competitive & Community Gap Matrix

Date: 2026-02-17  
Scope: Pottery studio operations only (no classes/workshops/storefront features)

## Method
- Competitor feature scan from product marketing pages.
- Community signal scan from `r/ceramics` and `r/pottery`.
- Repo baseline from existing reservation/queue documentation and tickets.

## Reservation API parity status update (2026-02-22)

- Epic alignment: reservation mutation contract now defaults to `apiV1` routes with legacy transport wrappers only.
- Compatibility window:
  - Review date: `2026-05-15`
  - Legacy sunset target: no earlier than `2026-06-30`
- Route-family parity coverage now exists for:
  - `reservations.create`
  - `reservations.update`
  - `reservations.assignStation`
- Station input normalization now uses shared station config across create + board-capacity paths.

## Feature gap matrix

- **Stage visibility + ETA confidence**
  - Evidence:
    - Kiln fire kiln status visibility and member-facing kiln state is explicit on site marketing. `https://kilnfire.com/` and `https://kilnfire.com/features`.
    - Pottery Pass and CeramicSys both present status staging with pickup-ready messaging.
  - Current repo status: queue + ETA scaffolding exists; server-side transitions and lane-level consistency still incomplete.
  - Gap priority: **P1**
  - Existing mapped tickets:
    - `tickets/P1-studio-reservation-status-api.md`
    - `tickets/P1-studio-queue-position-and-eta-band.md`
    - `tickets/P1-studio-reservation-stage-timeline-and-audit.md`

- **Piece-level traceability + photos/notes**
  - Evidence:
    - Pottery Pass advertises "unique tracking IDs" and lifecycle stage movement.
    - CeramicSys emphasizes images and searchable notes per item.
    - Reddit `Tracking Pieces` repeatedly asks for photo-first identification and fewer manual methods. `https://www.reddit.com/r/Ceramics/comments/1d0ty1k`
  - Current repo status: reservation-level notes + photo exists; structured piece rows and code-level traceability are not implemented.
  - Gap priority: **P2**
  - Existing mapped tickets:
    - `tickets/P2-studio-piece-traceability-with-piece-codes.md`
    - `tickets/P2-studio-arrival-checkin-and-qr-intake.md`

- **Member-assisted mobile intake (QR / short code)**
  - Evidence:
    - Pottery Pass markets QR-based piece submission and workflow from arrival to pickup.
    - Classly and Kiln Fire both show strong self-serve intake/booking patterns.
    - Reddit community signals suggest fragmented workaround systems rather than unified member input for workflow.
  - Current repo status: no member-initiated arrival/check-in flow for reservations.
  - Gap priority: **P2**
  - Existing mapped tickets:
    - `tickets/P2-studio-arrival-checkin-and-qr-intake.md`

- **Station/equipment-level capacity fairness**
  - Evidence:
    - Classly positions open-studio and equipment reservation management with no-overbooking focus.
    - Kiln Fire features include wheel/workstation reservations and member equipment bookings.
  - Current repo status: no dedicated station lane/capacity model for studio queue transitions.
  - Gap priority: **P2**
  - Existing mapped tickets:
    - `tickets/P2-studio-station-aware-routing-and-capacity-controls.md`

- **No-show enforcement and pickup escalation**
  - Evidence:
    - Competitor tools emphasize pickup reminders, ready/notifications, and reminders to clear shelf items.
    - Reddit posts describe studio workflows struggling with abandoned or unclaimed pieces.
  - Current repo status: pickup policy and reminder workflow is planned but not fully operationalized yet.
  - Gap priority: **P2**
  - Existing mapped tickets:
    - `tickets/P2-studio-pickup-window-booking.md`
    - `tickets/P2-studio-no-show-and-queue-fairness-policy.md`
    - `tickets/P2-studio-storage-hold-automation.md`

- **Resilience for staff actions in weak connectivity**
  - Evidence:
    - ClayLab’s product notes emphasize offline operation for users (for tracking workflows in general).
    - Studio operations surfaces are often used on phones/tablets; internet drops are a known operational issue in arts spaces.
  - Current repo status: no explicit offline-safe action queue for staff staff updates.
  - Gap priority: **P2**
  - Existing mapped tickets:
    - `tickets/P2-studio-offline-staff-kiosk-workflow-sync.md`

- **Automated notifications across channels + preference control**
  - Evidence:
    - Kiln Fire, Pottery Pass, and CeramicSys all promote message automation for pickup and status changes.
    - CeramicSys explicitly foregrounds SMS-first customer communication.
  - Current repo status: notification journey exists in planning; channel-level policy and fallback handling are incomplete.
  - Gap priority: **P2**
  - Suggested ticket:
    - `tickets/P2-studio-notification-channel-and-fallback-controls.md`

- **Data continuity / portability and continuity risk**
  - Evidence:
    - Community threads report app disappearance and data-loss anxiety around pottery tracking apps:
      - `https://www.reddit.com/r/Ceramics/comments/1el7bmb`
      - `https://www.reddit.com/r/Pottery/comments/vgbeky/what_is_everybodys_favorite_pottery_tracking_app/`
  - Current repo status: no dedicated portability/continuity policy for member+studio records.
  - Gap priority: **P2**
  - Suggested ticket:
    - `tickets/P2-studio-data-portability-and-backup-risks.md`

## Implementation sequencing recommendation

1. Complete P1 transition/API stability first (`P1-*`).
2. Run hardening wave across station lane fairness + check-in + offline action sync (`P2-studio-station-aware-routing-and-capacity-controls.md`, `P2-studio-arrival-checkin-and-qr-intake.md`, `P2-studio-offline-staff-kiosk-workflow-sync.md`).
3. Close comms and continuity layer (`P2-studio-notification-channel-and-fallback-controls.md`, `P2-studio-data-portability-and-backup-risks.md`).
4. Finish pickup + storage loop (`P2-studio-pickup-window-booking.md`, `P2-studio-storage-hold-automation.md`).

## Non-goals (still in scope control)
- classes/workshops onboarding
- storefront/ecommerce catalog
- private events workflows
- hardware integrations outside existing staff/portal architecture
