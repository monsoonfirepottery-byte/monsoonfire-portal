# P2 — Cross-surface terminology and trust design system contract

Status: In review
Date: 2026-04-14
Priority: P2
Owner: Design + Website + Portal
Type: Ticket
Parent Epic: tickets/P1-EPIC-21-live-surface-trust-and-service-operating-system.md

## Problem

The website and portal currently share intent but not always the same language or trust-state patterns. That drift weakens product-family coherence and makes support harder.

## Tasks

1. Define a shared vocabulary for core concepts such as Ware Check-in, reservation, queue, firing, cooling, ready, pickup, confirmed, tentative, and stale.
2. Define a minimal reusable component/state set for trust-oriented UI states: status chips, freshness rows, journey timeline, and guided fallback cards.
3. Link the contract into the relevant website and portal implementation tickets so wording and state patterns do not drift again.

## Acceptance Criteria

1. Cross-surface wording for core service states is intentional and documented.
2. Both surfaces can reuse the same status/freshness/fallback concepts without improvising new language.
3. Future trust-oriented UI work has one lightweight contract to reference.

## Dependencies

- `docs/audits/live-surface-audit-2026-04-12.md`
- `docs/standards/LIVE_SURFACE_TERMINOLOGY_AND_TRUST_CONTRACT.md`
- `website/`
- `web/`

## Implementation Notes

1. The shared terminology and trust-state contract now lives in `docs/standards/LIVE_SURFACE_TERMINOLOGY_AND_TRUST_CONTRACT.md`.
2. The contract documents canonical member-facing language for start surface, check-in, reservations, queues, pickup readiness, freshness, and guided fallbacks.
3. The live-surface epic now links directly to the contract so future changes have one reference point.
