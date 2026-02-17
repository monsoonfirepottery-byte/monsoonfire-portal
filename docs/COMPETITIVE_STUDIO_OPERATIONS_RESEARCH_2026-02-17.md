# Competitive Review — Pottery Studio Operations (No Classes/Workshops/Store Focus)

## Scope
Date: 2026-02-17

### Reviewed
- Competitor websites: Kiln Fire, Kilnfox, CeramicSys, Pottery Pass
- Reddit communities: `r/Pottery`, `r/Ceramics`

Focus: reservation status flow, queue fairness, piece tracking, pickup, staff workflow, and visibility.

## Competitor observations (studio operations only)

- **Kiln Fire**
  - Piece tracking + firing workflow management
  - Notification trigger path when items are ready and when status changes
  - Receipt/barcode-style operational workflows for kiln loading and unload confirmation
  - Kiln visibility from maker-facing side
  - Source: https://kilnfire.com/

- **Kilnfox**
  - Piece and firing stage tracking through drying, bisque, glaze, and pickup
  - Automated customer notifications by stage transition
  - Pickup coordination and status transparency
  - Source: https://kilnfox.com/en/pottery-studio-management-software/

- **Pottery Pass**
  - Piece IDs and custom stage control
  - QR/submission workflows tied to piece-level intake
  - Automated pickup alerts and status pages
  - Source: https://www.potterypass.com/

- **CeramicSys**
  - Centralized records + order tracking
  - Stage visibility and customer notifications
  - Source: https://ceramicsys.com/about

## Expanded competition scan (studio operations focus)

- **Kiln Fire**
  - Claims explicit automation around billing, piece tracking, piece photo flow, and status notifications for firing and pickup.
  - Strong signal for our roadmap: customer expects no extra channel hopping to know if a piece is in queue, in kiln, cooled, or ready.
  - Source: https://kilnfire.com/

- **CeramicSys**
  - Positions itself as pottery-specific operational software with SMS updates, piece tracking, and kiln workflow visibility.
  - Strong signal for missing user communications parity: SMS/notification reliability + timeline clarity.
  - Source: https://ceramicsys.com/
  - Notes from page scan:
    - `Reduce the flood of “Where’s my pottery?” messages` with optional tracking.
    - `Attach images and notes to each item` for searchable piece identification.
    - SMS packs for customer notifications.

- **Classly / Zenamu**
  - Both emphasize open studio/workspace scheduling, waitlist behavior, and capacity-safe reservation management.
  - Strong signal for our gap: we have queue and status work, but no explicit station/workspace resource model yet.
  - Sources:
    - https://classly.com/
    - https://zenamu.com/for-studio/ceramics/

- **Pottery Pass**
  - Public messaging highlights traceability IDs, QR submission flow, auto notifications, and custom stage controls.
  - Strong signal for our gap: richer intake mechanisms (QR + structured stage transitions) that stay editable on the backend.
  - Source: https://www.potterypass.com/
  - Notes from page scan:
    - `Digital Piece Tracking` with unique tracking IDs.
    - `QR Submission Form` for member intake.
    - `Custom Workflows` and automated stage/pickup alerts.

## Reddit signals
- `r/Ceramics` thread on Android tracking apps shows strong concern about app continuity and data ownership:
  - `https://www.reddit.com/r/Ceramics/comments/1el7bmb`
  - Users report app disappearance and hard data export/backup, which drives a need for owned records and portability.
- `r/Pottery` discussion on studio piece tracking (including Kiln Fire founder input) explicitly calls out stage visibility, automated notifications, and barcode scan workflow:
  - `https://www.reddit.com/r/Pottery/comments/bxe1jq`
- `r/Ceramics` post about discontinued/fragile tracking app options confirms a long-running market pain around continuity and backup portability.
- `r/Pottery` tracking-firing threads repeatedly include repeated workaround suggestions (`Google group`, `notify` workflows, manual reminders), indicating sustained demand for status updates and communication automation.
  - `https://www.reddit.com/r/Pottery/comments/15nga0y`
- `r/Pottery` software preference thread shows users evaluating tools for piece tracking and note/photo workflows, reinforcing demand for a stable, searchable studio-native operational system.
  - `https://www.reddit.com/r/Pottery/comments/vgbeky`

### Direct software need signals from recent threads

- `r/Pottery` users repeatedly request improved studio tracking workflows beyond spreadsheets and paper notes.
  - Example signal: `Test Tile Tracker` thread where users ask to expand to broader workflow use cases and structured metadata, implying need for scalable record keeping.
  - Source: https://www.reddit.com/r/Pottery/comments/1ifx371

- `r/Pottery` and `r/Ceramics` users mention app tooling limits, including missing features and offline/fragmented workflows that force workaround tools.
  - Examples include user calls for cross-platform reliability and better stage/photos metadata capture.
  - Sources:
    - https://www.reddit.com/r/Pottery/comments/vgbeky/what_is_everybodys_favorite_pottery_tracking_app/
    - https://www.reddit.com/r/Ceramics/comments/1hrr4n6

- `r/Ceramics` and `r/Pottery` threads also show continuity risk around platform/app discontinuation and portability:
  - https://www.reddit.com/r/Ceramics/comments/1el7bmb
  - https://www.reddit.com/r/Pottery/comments/vgbeky/what_is_everybodys_favorite_pottery_tracking_app/

- A recurring pattern in discussion threads is manual `spreadsheet`/notes fallback for inventory, glaze tests, and project tracking despite existing apps, which suggests operational software still misses core onboarding for real studio workflows.
  - Source: https://www.reddit.com/r/Pottery/comments/1r5lrrn/keeping_track_of_glazes/

## Repo gap mapping

### Confirmed missing or incomplete in current implementation
- no production `updateReservation` endpoint path currently serving staff lifecycle transitions
- no full transition audit + timeline trail on reservation state updates
- no robust client-facing queue position/ETA band in reservation cards
- website kiln board is static/manual via `website/data/kiln-status.json`
- explicit no-show/fairness controls not present in reservation queue flow

### Existing foundation to build from
- createReservation endpoint + reservation write path is in place
- reservation model and policy docs already include `loadStatus`, `estimatedWindow`, and pickup-related fields as expansion targets
- `ReservationsView` + `KilnLaunchView` already render queue and status context; they need richer state transitions
- `web/src/api/portalContracts.ts` already defines `UpdateReservationRequest`

## Additional candidate gaps discovered after competitor scan

- station-level capacity and throughput constraints are still implicit rather than first-class
- arrival/check-in and mobile self-service behaviors are under-specified
- staff update resilience in weak-connectivity environments is not documented
- communication channel strategy is still light on structured, status-driven multi-channel delivery (SMS is not consistently documented in product flow)

## Recommended execution priority (P1/P2)

1. Stage-aware reservation transitions with server validation and audit trail.
2. Queue position + ETA band surfacing in client/staff reservation views.
3. Website kiln status board powered by same workflow state source.
4. Pick-up window booking + reminders + hold escalation.
5. Queue fairness + no-show policy enforcement.

## Ticket mapping generated

- `tickets/P1-studio-reservation-stage-timeline-and-audit.md`
- `tickets/P1-studio-queue-position-and-eta-band.md`
- `tickets/P1-website-studio-kiln-status-sync-board.md`
- `tickets/P2-studio-pickup-window-booking.md`
- `tickets/P2-studio-no-show-and-queue-fairness-policy.md`

### New proposed tickets from scan

- `tickets/P2-studio-station-aware-routing-and-capacity-controls.md`
- `tickets/P2-studio-offline-staff-kiosk-workflow-sync.md`
- `tickets/P2-studio-arrival-checkin-and-qr-intake.md`
- `tickets/P2-studio-notification-channel-and-fallback-controls.md`
- `tickets/P2-studio-data-portability-and-backup-risks.md`

### Supporting analysis docs

- `docs/STUDIO_OPERATIONS_GAP_MATRIX_2026-02-17.md`
