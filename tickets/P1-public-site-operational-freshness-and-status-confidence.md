# P1 — Public site operational freshness and status confidence

Status: In review
Date: 2026-04-14
Priority: P1
Owner: Website + Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-21-live-surface-trust-and-service-operating-system.md

## Problem

Public operational surfaces currently expose stale timestamps, raw loading copy, and uncertain event language. That makes the studio feel less actively operated than it needs to.

## Tasks

1. Define a public freshness model for kiln status, public updates, and event/community programming.
2. Replace raw loading copy with structured loading, stale, and unavailable states.
3. Add visible timestamps and certainty labels such as confirmed, tentative, delayed, or stale where they materially improve trust.
4. Document the expected refresh cadence and fallback behavior so the state model is maintainable.

## Acceptance Criteria

1. Public operational modules never rely on raw `Loading...` copy as the primary production state.
2. Every operational data card shows either a valid freshness timestamp or an intentional fallback state.
3. Event/programming surfaces distinguish confirmed content from tentative content.

## Implementation Notes

1. Kiln board copy now prefers calm sync/freshness messaging over raw loading-first placeholders.
2. Static kiln status JSON is used before the API fallback on the static website server, eliminating the homepage console 404 in smoke coverage.
3. Stale-state messaging is explicit and visually supported on both the website and `ncsitebuilder` variants.

## Dependencies

- `website/index.html`
- `website/updates/index.html`
- `website/faq/index.html`
- `website/data/kiln-status.json`
- `website/assets/js/main.js`
