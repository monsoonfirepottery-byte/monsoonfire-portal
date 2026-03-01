# P1 — Staff Console: Sample Workshop Seeding for Testing and Canary

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Staff Console + QA Automation
Type: Ticket
Parent Epic: tickets/P1-EPIC-15-staff-console-usability-and-signal-hardening.md

## Problem

Testing and canary coverage lacks stable sample workshop/event content, making automated checks brittle and inconsistent.

## Objective

Provide repeatable sample workshop seed data that supports deterministic portal testing and authenticated canary scripts.

## Scope

1. Define minimal workshop seed fixture contract (titles, schedule windows, capacities, statuses).
2. Add safe seeding path for non-production environments.
3. Wire fixture usage into QA/canary scripts.

## Tasks

1. Create a sample workshop fixture schema and canonical dataset.
2. Implement seeding command/path with idempotent behavior.
3. Add teardown/reset command for repeatable test runs.
4. Update canary/test scripts to assert against seeded workshop fixtures.

## Acceptance Criteria

1. Staff/QA can seed sample workshops in a single command.
2. Seeding is idempotent and safe for non-production runs.
3. Canary scripts use seeded fixtures and no longer rely on ad-hoc event state.
4. Cleanup/reset path exists for fixture lifecycle hygiene.

## Completion Evidence (2026-02-27)

- Fixture steward now seeds a published workshop/event fixture (`QA Fixture Workshop ...`) and tracks it in fixture state for TTL cleanup in [`scripts/portal-fixture-steward.mjs`](/home/wuff/monsoonfire-portal/scripts/portal-fixture-steward.mjs).
- Fixture validation and cleanup now include the seeded workshop event path, with warning-mode behavior when service-account admin token is unavailable.
- Authenticated canary now asserts seeded workshop visibility on the Workshops page (`canary-04b-workshops-seeded.png`) in [`scripts/portal-authenticated-canary.mjs`](/home/wuff/monsoonfire-portal/scripts/portal-authenticated-canary.mjs).
- Automation matrix documentation updated to reflect workshop fixture seeding and canary coverage in [`docs/runbooks/PORTAL_AUTOMATION_MATRIX.md`](/home/wuff/monsoonfire-portal/docs/runbooks/PORTAL_AUTOMATION_MATRIX.md).
