# EPIC: PORTAL-QA-AUTOMATION-COVERAGE

Status: Active
Owner: Platform / QA / Portal
Created: 2026-02-26

## Mission

Close recurring QA gaps by automating functional, authz, index, theme-readability, fixture, and deploy-promotion checks for portal workflows.

## Scope

- Add emulator-backed PR authz/functional gate.
- Add authenticated daily production canary for non-staff pages.
- Add Firestore index contract guard with issue loop.
- Add dedicated theme contrast regression automation.
- Add post-deploy promotion gate after production deploy.
- Add fixture steward automation with TTL cleanup.
- Add live-surface trust guards for portal handoff parity, stale public signals, and placeholder regressions.

## Success Criteria

- Known regressions (permission denied, missing index, unreadable dark-theme text) are detected by automation before manual verification loops.
- Deploy confidence includes canary + backend authz + index guard.
- QA fixtures are consistently available for repeatable testing without manual seeding.

## Non-goals

- Replacing human exploratory QA.
- Auto-merging code changes.
- Auto-deploying index changes without review.

## Audit Follow-up Backlog (2026-04-14)

The live-surface audit surfaced a set of trust leaks that should become deterministic regression guards instead of recurring manual review items:

1. legacy portal host links must fail CI and scheduled smoke
2. stale or missing freshness states on public operational surfaces should be detectable
3. generic placeholder copy should not appear in member-critical portal routes
4. portal route semantics should continue to distinguish Ware Check-in intent from generic reservations

## Child Tickets

- `tickets/P1-live-surface-trust-automation-and-parity-guards.md`
