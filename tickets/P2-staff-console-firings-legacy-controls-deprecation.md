# P2 — Staff Console: Firings Legacy Controls Deprecation

Status: Completed
Date: 2026-02-27
Priority: P2
Owner: Staff Console + Kiln Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-15-staff-console-usability-and-signal-hardening.md

## Problem

Legacy firings controls (`syncFiringsNow`, `acceptFiringsCalendar`, `debugCalendarId`) are high-risk/low-frequency and add clutter to the primary firings workflow.

## Objective

Deprecate legacy controls from default staff workflows while preserving an explicit advanced path for controlled use.

## Scope

1. Hide legacy controls from default firings actions.
2. Keep controls accessible via explicit advanced toggle during transition.
3. Add deprecation messaging and follow-up removal plan.

## Tasks

1. Move legacy controls under a non-default "show deprecated controls" toggle.
2. Add clear deprecation copy to prevent accidental day-to-day use.
3. Track any remaining usage and define final removal date.

## Acceptance Criteria

1. Legacy controls are not visible by default in Firings.
2. Staff can still reach controls through explicit advanced toggle.
3. Deprecation intent is visible in UI copy.

## Completion Evidence (2026-02-27)

- Firings legacy controls now render behind a non-default toggle in [`web/src/views/StaffView.tsx`](/home/wuff/monsoonfire-portal/web/src/views/StaffView.tsx).
