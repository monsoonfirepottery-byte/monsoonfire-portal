# P1 — Staff Console: Cockpit Dedicated Workspace and Layout Split

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Staff Console UX + Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-15-staff-console-usability-and-signal-hardening.md

## Problem

Cockpit does not provide enough real estate for staff triage. Operators must compress critical data/actions into limited space, increasing scan time and context switching.

## Objective

Provide a dedicated cockpit workspace with a layout split that supports high-density triage while keeping high-priority actions immediately reachable.

## Scope

1. Dedicated cockpit workspace mode for staff operations.
2. Layout split strategy for queue/status/action surfaces.
3. Responsive behavior so key triage workflows remain usable across desktop/laptop widths.

## Tasks

1. Define a dedicated cockpit workspace entry that prioritizes triage over secondary modules.
2. Implement a durable layout split model for data-heavy views (for example queue pane + detail/action pane).
3. Improve section hierarchy to reduce visual competition in the primary triage viewport.
4. Add guardrails so critical actions remain visible without excessive scrolling.
5. Add regression checks for common staff viewport sizes and triage actions.

## Acceptance Criteria

1. Staff has a dedicated cockpit workspace path with visibly increased usable area.
2. Core triage surfaces are accessible in a split layout without repeated context switching.
3. Critical actions remain discoverable and usable at standard staff viewport sizes.
4. Operator feedback confirms reduced scan/scroll burden for daily triage tasks.
5. No loss of existing cockpit capabilities after layout restructuring.

## Completion Evidence (2026-02-27)

- Legacy `System` module state now redirects to Cockpit platform diagnostics, consolidating platform/ops workflows into one workspace in [`web/src/views/StaffView.tsx`](/home/wuff/monsoonfire-portal/web/src/views/StaffView.tsx).
- Cockpit remains the focused workspace mode with module-rail toggle and retained platform diagnostics/actions, reducing module-switch churn for staff triage.
- Added dedicated cockpit deep-link workspace (`/staff/cockpit`) via [`web/src/App.tsx`](/home/wuff/monsoonfire-portal/web/src/App.tsx) with locked cockpit focus mode in [`web/src/views/StaffView.tsx`](/home/wuff/monsoonfire-portal/web/src/views/StaffView.tsx).
- Added explicit CTA to open cockpit in a dedicated page and to return to full Staff console when broader module navigation is needed.
