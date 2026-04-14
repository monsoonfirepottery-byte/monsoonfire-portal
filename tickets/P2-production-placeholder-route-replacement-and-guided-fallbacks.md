# P2 — Production placeholder route replacement and guided fallbacks

Status: Active
Date: 2026-04-14
Priority: P2
Owner: Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-21-live-surface-trust-and-service-operating-system.md

## Problem

Generic placeholder routes and low-context empty states make the portal feel unfinished when users land outside the happy path.

## Tasks

1. Replace generic placeholder copy with route-aware fallback cards.
2. Provide an alternate path, support action, or explicit next step for unresolved routes and incomplete areas.
3. Reuse the same fallback pattern for empty and error-adjacent states where possible.
4. Add tests that catch generic placeholder copy leaking into member-critical routes.

## Acceptance Criteria

1. User-critical routes do not render generic “coming soon” language.
2. Fallback states always tell the user what they can do next.
3. Placeholder regressions are testable and visible before release.

## Dependencies

- `web/src/views/PlaceholderView.tsx`
- `web/src/App.tsx`
- `web/src/views/ProfileView.tsx`
- `web/src/views/StaffView.tsx`
