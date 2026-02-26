# Studio Operations Deep Review and Action Plan
Date: 2026-02-17  
Scope: Monsoonfire Portal website + studio operations stack

## 1) Repo review summary (current state)

What is already implemented (despite earlier docs suggesting missing):
- Reservation lifecycle transitions are implemented in functions:
  - `updateReservation` exists and is exported in `functions/src/index.ts`.
  - Stage/history/audit updates are present in the update path.
- Station assignment is implemented:
 - `assignReservationStation` exists and is exported in `functions/src/index.ts`.
- Portal web client contracts and API methods already include many reservation operations.
- Frontend view for kiln load status already calls reservation update methods (`KilnLaunchView`).

Current implementation gaps:
- Reservation REST surface is not exposed through the `apiV1` router.
- Reservation normalizer remains narrower than documented schema, so several fields may be dropped in UI normalization.
- Website kiln board is still static/manual (`/data/kiln-status.json`) rather than source-of-truth-driven.

Doc/plan debt:
- Existing planning tickets and matrix files still list several implemented items as pending.
- Missing/partial cross-linking between:
  - backend capabilities,
  - API surface,
  - docs/schema claims,
  - website feature behavior.

## 2) Sources reviewed in this pass

- Internal docs:
  - `docs/STUDIO_OPERATIONS_GAP_MATRIX_2026-02-17.md`
  - `docs/COMPETITIVE_STUDIO_OPERATIONS_RESEARCH_2026-02-17.md`
  - `docs/SCHEMA_RESERVATIONS.md`
  - Open tickets under `tickets/`
- Public market references (recent snapshots via web search):
  - Pottery Pass: workflow, stage control, auto notifications, status-based piece tracking
  - Classly: class scheduling, memberships, class/workspace reservations, membership status workflows
  - Kiln Fire, CeramicSys mentions, PotteryPass, Mud Studio, Classly, Kilnfox
- Reddit signals (r/Ceramics / r/Pottery):
  - App continuity/data portability concerns (discontinued/vanishing apps, backups, Android availability)
  - Feature asks around piece tracking + updates + platform stability
  - Adoption friction for studios (older staff/legacy habits) and cancellation policy needs

## 3) New backlog: Epics and tickets to execute

### Epic A: Close API/Schema/Data Integrity Gap
- Owner: Web + Functions + API contracts
- Why now:
  - Prevents false negatives in planning and keeps front/back parity.
- Includes:
  - Expose reservation lifecycle + station assignment endpoints through API v1 router.
  - Add schema-preserving normalization for missing reservation fields.
  - Add contract tests or snapshot tests for request/response shape stability.
  - Add migration-aware docs for optional fields and defaults.

### Epic B: Studio board and operations UX parity
- Owner: Website + Studio operations dashboard
- Why now:
  - Current kiln-status board was static/manual at planning time, while core data was already in Firestore/functions.
  - Update (2026-02-25): live-feed cutover is now implemented; remaining work is operations QA and stale-state controls.
- Includes:
  - Replace static JSON status board with dynamic source feed.
  - Add polling or push path for live kiln load status updates.
  - Add explicit state, ETA band, and SLA confidence display.

### Epic C: Customer communication reliability for studio workflows
- Owner: Product + Backend + Notifications
- Why now:
  - Reddit/user signals repeatedly mention communication fatigue (“when will it be done?”).
- Includes:
  - Standardized status transition events.
  - Notification preferences per channel (email/SMS/in-app) and suppression windows.
  - ETA bands + stale-state reminders + ready-for-pickup confirmations.

### Epic D: GA+analytics alignment and instrumentation
- Owner: Website + Analytics
- Why now:
  - User wants GA-informed planning; website review should be closed-loop against behavior.
- Includes:
  - Map major studio operations funnels in GA (reservation create → station assigned → kiln started → ready → pickup).
  - Add events for manual overrides and late status transitions.
  - Create monthly “feature drop-off” report.

## 4) Recommended tickets (ready to implement)

New tickets to create:
- `tickets/P1-studio-operations-data-contract-and-api-parity-epic.md` (Epic A parent ticket)
- `tickets/P2-studio-operations-web-kiln-board-live-feed-ticket.md` (Epic B)
- `tickets/P2-studio-operations-notification-sla-engineering-ticket.md` (Epic C)
- `tickets/P3-studio-analytics-ga-funnel-and-event-schema-ticket.md` (Epic D)

## 5) Priority plan (first 60 days)

1. Implement API v1 endpoints + doc updates (Epic A) to remove implementation uncertainty.
2. Expand reservation normalization schema mapping (Epic A).
3. Keep kiln-status board live-feed parity healthy via sync checks/runbook (Epic B).
4. Add notification SLA/ETA confidence on status transitions (Epic C).
5. Add GA event instrumentation and dashboard (Epic D).

## 6) Success criteria

- No planned ticket remains open for an item that is already implemented in functions or web API clients.
- Reservation detail pages consistently show schema fields in `SCHEMA_RESERVATIONS.md`.
- Kiln board updates without code or JSON manual file changes.
- At least one closed-loop funnel report runs from production logs/analytics each month.
- Clear reduction in “manual status inquiry” signals in customer support or feedback logs.
