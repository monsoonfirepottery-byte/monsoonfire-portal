# P1 — Portal member start surface and task-first navigation

Status: Active
Date: 2026-04-14
Priority: P1
Owner: Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-21-live-surface-trust-and-service-operating-system.md

## Problem

The portal contains meaningful capability, but first-time members still have to infer where to begin from the nav structure itself.

## Tasks

1. Define a member-first start surface that answers “what is this,” “what can I do here,” and “what should I do first?”
2. Add task-first shortcuts for high-value intents such as Ware Check-in, queue/status, membership, resources, and support.
3. Preserve staff-specific paths while preventing staff information architecture from becoming the default member mental model.
4. Keep the routing and module structure compatible with current portal state and deep-link expectations.

## Acceptance Criteria

1. Signed-in members see a recommended next action without exploring the full nav.
2. The portal presents a clearer split between member tasks and staff/operator tasks.
3. First-use confusion decreases without removing current capability.

## Dependencies

- `web/src/App.tsx`
- `web/src/views/ProfileView.tsx`
- `web/src/views/StaffView.tsx`
- `web/src/views/MyPiecesView.tsx`
