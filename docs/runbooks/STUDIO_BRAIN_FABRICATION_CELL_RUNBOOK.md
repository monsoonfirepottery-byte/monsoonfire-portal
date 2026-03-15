# Studio Brain Fabrication Cell Runbook

Purpose: operate the Bambu X1C as a Studio Brain-managed fabrication cell for internal studio tooling, not as a member-facing booking surface.

## Scope

- `PLA` and `PETG` only.
- Internal tooling first.
- Hybrid output library:
  - ceramics tooling
  - studio infrastructure
- Ops-lane first: no portal UI or member-facing SLA in v1.

## Source of truth

- Domain model: `studio-brain/src/fabrication/model.ts`
- Seed assets and pilot fixtures: `studio-brain/src/fabrication/defaults.ts`
- Intake/queue/stock/maintenance/learning helpers: `studio-brain/src/fabrication/workflows.ts`
- Dry-run verification: `studio-brain/src/fabrication/workflows.test.ts`
- Studio Brain extension note: `studio-brain/docs/FABRICATION_CELL.md`

## Internal records

1. `printer_asset`
- Machine profile, safe materials, nozzle/plate setup, maintenance intervals, operating constraints, and current status.

1. `print_job`
- Requester, purpose, lane, urgency, linked source, material, grams estimate, runtime estimate, status, disposition, and reuse decision.

1. `print_library_item`
- Approved repeatable part with aliases, settings, evidence checklist, and replacement trigger.

1. `consumable_stock`
- Spool state, remaining grams, drying notes, and operational readiness.

1. `maintenance_task`
- Condition-triggered tasks for plate cleaning, calibration, nozzle inspection, and similar reliability work.

## Event vocabulary

- `fabrication.request`
- `fabrication.plan`
- `fabrication.stock_alert`
- `fabrication.maintenance_due`
- `fabrication.complete`
- `fabrication.fail`

These are internal agent-facing events for the fabrication lane. They are not public APIs.

## Agent routines

1. Intake agent
- Match incoming requests to approved library items when possible.
- Escalate any request that lacks measurements or a linked source.
- Default unknown-but-well-specified requests into the custom job lane.

1. Queue agent
- Enforce queue order:
  - `ops_critical`
  - `repeatable_tooling`
  - `maintenance`
  - `experiment`
- Bias approved library reuse ahead of equally urgent custom work.

1. Stock and maintenance agent
- Block jobs when safe material stock is insufficient.
- Open maintenance work before repeat failures compound.
- Keep low-stock PETG visible because it is the main structural constraint in the seeded pilot.

1. Learning agent
- Capture photo evidence and operator notes for every completed or failed print.
- Promote successful repeatable custom work into a candidate library item.
- Keep one-off work out of the approved library unless it proves reusable.

## Pilot rhythm

Daily:
- Review new `print_job` requests.
- Clear or escalate ambiguous requests before queueing.
- Confirm material coverage before approving physical print starts.

Weekly:
- Review top reused library items.
- Review failed prints and resulting maintenance tasks.
- Review whether any custom jobs should graduate into the library.

30-day pilot success check:
- Every print has a record.
- Every completed print has notes and evidence.
- At least one custom success graduates into the reusable library or proves a clear saved-purchase path.
- Queue failures are visible as stock or maintenance issues, not silent surprises.

## Dry-run validation

The seeded fixtures intentionally cover:

- approved library reuse
- custom infrastructure planning
- low-stock PETG blocking
- ambiguous intake escalation
- second approved library reuse path

Run:

```bash
npm --prefix studio-brain test
```

The fabrication module tests verify the dry-run outcomes, queue ordering, maintenance triggers, and learning promotion behavior.

## Phase 2 boundary

If the pilot proves value, the next integration step should be a read-only dashboard inside existing Monsoon Fire reservations/equipment/agent-ops patterns. Do not add member booking or pricing until the ops taxonomy and library are stable.
