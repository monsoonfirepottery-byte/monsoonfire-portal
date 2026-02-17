# P2 — Station-Aware Reservation Routing and Capacity Controls

Status: Open
Date: 2026-02-17

## Problem
Reservations currently flow as a global queue without first-class station, kiln, or capacity modeling. As a result, staff still must manually enforce which run a reservation belongs to, which can cause bottlenecks, overbooking risk, and unclear ETA confidence.

## Objective
Add a station-aware queue model so staff and members both get accurate, enforceable scheduling around kiln/station capacity and throughput.

## Scope
- Reservation model + queue service docs
- `functions/src` reservation lifecycle handlers and validation
- `web/src/views/KilnLaunchView.tsx`
- `web/src/views/ReservationsView.tsx`
- `docs/SCHEMA_RESERVATIONS.md`
- `docs/COMPETITIVE_STUDIO_OPERATIONS_RESEARCH_2026-02-17.md` references

## Tasks
1. Define station-aware routing fields in schema:
   - `assignedStationId` (`auto`, `studio-kiln-A`, `studio-kiln-B`, etc.)
   - `requiredResources` (kiln profile, rack count, piece class)
   - `lane` / `queueClass` so queue fairness can be computed separately per station.
2. Add server-side capacity constraints for station assignments:
   - no simultaneous over-capacity loading of a station,
   - explicit queue blocking when capacity is exceeded,
   - deterministic conflict detection for load/reservation transitions.
3. Extend queue ranking to account for station lanes:
   - station-specific sorting rules,
   - lane-level ETA bands, and
   - visible reason text for why a reservation is queued.
4. Update staff queue UX:
   - quick station assignment actions,
   - station availability badges,
   - filter by lane and capacity pressure.
5. Add a lightweight station availability endpoint contract for website and staff surfaces.
6. Update docs and runbook with station-bound workflow assumptions and manual fallback if station capacity data is missing.

## Acceptance
- Any station assignment action enforces capacity constraints server-side.
- ETA and queue position can change per station lane and are stable across clients.
- Staff can assign reservations to stations without duplicate/invalid overlaps.
- At least one station-level scenario is represented in docs and test guidance (manual or automated).

## Dependencies
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-queue-position-and-eta-band.md`
- `tickets/P1-studio-reservation-stage-timeline-and-audit.md`

