# EPIC: LIVE-SURFACE-TRUST-AND-SERVICE-OPERATING-SYSTEM

Status: Active
Date: 2026-04-14
Priority: P1
Owner: Website + Portal + Ops
Type: Epic
Epic Ticket: tickets/P1-EPIC-21-live-surface-trust-and-service-operating-system.md

## Problem

The April 2026 live-surface audit showed that Monsoon Fire has real product depth, but the public website and portal still do not consistently feel like one calm, high-trust studio operating system.

The biggest trust leaks are not visual-fashion issues. They are operational:

1. mixed public-to-portal handoff targets
2. stale or vague freshness signals
3. ambiguous member-first navigation inside the portal
4. Ware Check-in language that still reflects internal reuse instead of the user task
5. generic placeholder fallbacks in production routes
6. queue and piece status communication that is still too black-box for fragile artwork service

## Objective

Turn the website and portal into a more coherent, modern, app-like service platform that feels current, operationally clear, and safe to trust with meaningful work.

## Audit Artifact

- `docs/audits/live-surface-audit-2026-04-12.md`

## Scope

1. Canonical public website to portal handoff and login parity.
2. Public freshness contract for kiln status, updates, and event certainty.
3. Portal member-first start surface and task-first navigation.
4. Ware Check-in clarity and piece journey confidence.
5. Guided fallback states instead of generic placeholders.
6. Shared terminology and trust-oriented component patterns across both surfaces.

## Non-goals

1. Rewriting the visual identity from scratch.
2. Decorative motion with no clarity or trust benefit.
3. Replacing staff workflows with member-facing abstractions that remove needed control.
4. Claiming live visual fixes are complete without direct browser verification.

## Tasks

1. Standardize all public portal/login handoffs and portal intent routing.
2. Ship freshness and confidence labeling for public operational surfaces.
3. Add a task-first member start surface and clearer portal information architecture.
4. Separate Ware Check-in framing from general reservations and improve queue/status communication.
5. Replace generic production placeholders with guided fallback states.
6. Publish a cross-surface terminology and trust-component contract.

## Acceptance Criteria

1. No public website page links to a legacy or conflicting portal host.
2. Public operational surfaces show clear freshness or certainty state instead of vague fallback copy.
3. First-time members can identify a recommended next action without reverse-engineering the portal nav.
4. Ware Check-in clearly reads as intake, not generic reservation management.
5. Member-visible status surfaces explain where work is, what changed last, and what happens next.
6. Generic “coming soon” portal fallbacks are removed from user-critical routes.

## Child Tickets

- `tickets/P1-EPIC-21-live-surface-trust-and-service-operating-system.md`
- `tickets/P1-website-portal-canonical-handoff-and-login-parity.md`
- `tickets/P1-public-site-operational-freshness-and-status-confidence.md`
- `tickets/P1-portal-member-start-surface-and-task-first-navigation.md`
- `tickets/P1-portal-ware-check-in-queue-status-and-piece-journey-clarity.md`
- `tickets/P2-production-placeholder-route-replacement-and-guided-fallbacks.md`
- `tickets/P2-cross-surface-terminology-and-trust-design-system-contract.md`

## Cross-Epic Links

- QA ownership for parity, placeholder, and stale-state regression guards lives in `docs/epics/EPIC-PORTAL-QA-AUTOMATION-COVERAGE.md`.
- Portal staff/module structure changes that affect navigation clarity should stay aligned with `docs/epics/EPIC-STAFF-PORTAL-MODULE-CONSOLIDATION.md`.
