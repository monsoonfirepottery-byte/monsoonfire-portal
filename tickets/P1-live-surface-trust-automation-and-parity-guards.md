# P1 — Live-surface trust automation and parity guards

Status: Active
Date: 2026-04-14
Priority: P1
Owner: Platform / QA / Website / Portal
Type: Ticket
Parent Epic: docs/epics/EPIC-PORTAL-QA-AUTOMATION-COVERAGE.md

## Problem

Several high-confidence trust leaks from the live-surface audit are deterministic enough to catch automatically, but they currently depend on human memory:

1. legacy public links to `monsoonfire.kilnfire.com`
2. stale or vague freshness handling on public operational surfaces
3. generic placeholder text leaking into portal routes
4. regressions where Ware Check-in intent collapses back into undifferentiated reservation language

## Tasks

1. Extend website parity checks so public handoff links fail on legacy hosts across built and source variants.
2. Add a stale-data guard or audit script for public operational artifacts that should always expose freshness metadata or fallback state.
3. Add a route/content guard that flags generic placeholder copy in member-critical portal surfaces.
4. Add or extend smoke coverage that verifies Ware Check-in remains a distinct member intent path.

## Acceptance Criteria

1. CI or scheduled automation fails when public portal links regress to the legacy host.
2. Public status surfaces are guarded by a deterministic freshness/parity check.
3. Placeholder regressions in critical portal routes become visible before release.
4. The audit’s most repeatable trust leaks are no longer chat-only knowledge.

## Dependencies

- `website/tests/marketing-site.spec.mjs`
- `scripts/check-agent-surfaces.mjs`
- `scripts/portal-playwright-smoke.mjs`
- `website/`
- `web/`
