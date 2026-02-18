# Ticket: P2 — Studio Website Kiln Board Live Feed

Status: Planned
Created: 2026-02-17  
Priority: P2  
Owner: Website Team  
Type: Ticket

## Problem

The kiln status board is currently backed by `website/data/kiln-status.json`, which requires manual maintenance and does not reflect real-time studio state.

## Goal

Replace static source with live data from existing operational stores/functions.

## Scope

1. Define a server endpoint or client path for kiln status:
   - live reservations with kiln/station linkage
   - in-progress firings
   - ready/pickup queue state
2. Replace JSON polling/file editing flow with service-backed state.
3. Add lightweight loading/refresh indicators and stale-state warnings.
4. Add admin-only manual override controls for exception handling.
5. Add periodic sync validation and cache policy (e.g., 30s/60s polling or push where feasible).

## Acceptance Criteria

- No runtime dependency on `website/data/kiln-status.json` for production status.
- Board updates status within the defined sync interval.
- Supports at least:
  - current load count
  - estimated ready window
  - storage location/queue lane state
  - pickup status and delay reason (if available)
- Graceful handling of missing/partial data.

## Dependencies

- API and schema parity ticket.

## Definition of Done

- Manual status file update process removed from deployment runbook.
- Visual board and underlying API payload pass manual QA scenario set.
