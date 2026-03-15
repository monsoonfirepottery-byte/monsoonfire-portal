# Fabrication Cell Extension

This repo now includes an ops-lane fabrication module for the studio Bambu X1C.

## Source of truth

- Domain model: `src/fabrication/model.ts`
- Seed data and pilot fixtures: `src/fabrication/defaults.ts`
- Rules-based intake, planning, queue, maintenance, and learning helpers: `src/fabrication/workflows.ts`
- Dry-run coverage: `src/fabrication/workflows.test.ts`

## What this extension does

- Keeps the first version outside the portal product surface.
- Treats the printer as a Studio Brain-managed fabrication cell for internal tooling.
- Restricts the pilot to `PLA` and `PETG`.
- Encodes the internal event vocabulary:
  - `fabrication.request`
  - `fabrication.plan`
  - `fabrication.stock_alert`
  - `fabrication.maintenance_due`
  - `fabrication.complete`
  - `fabrication.fail`

## Seeded pilot assets

- One Bambu X1C printer asset profile.
- Six approved starter library items across:
  - ceramics tooling
  - studio infrastructure
- Consumable stock rows with low-stock PETG behavior.
- Baseline maintenance task.
- Five dry-run intake fixtures.

## Expected operating shape

1. Intake agent classifies requests into library reuse, custom planning, or escalation.
1. Queue agent ranks work with `ops_critical > repeatable_tooling > maintenance > experiment`.
1. Stock and maintenance checks block jobs before a print strands the queue.
1. Learning capture promotes successful repeatable customs into candidate library items.

## Current boundary

- No member-facing booking, pricing, or SLA surfaces.
- No direct printer-control integration.
- Human remains in the loop for every physical machine action.
