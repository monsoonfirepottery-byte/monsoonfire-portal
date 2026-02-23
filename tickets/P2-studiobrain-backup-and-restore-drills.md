# P2 — Backup, Restore, and Drill Automation for Studiobrain

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: Platform + Studio Brain
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Reliability improves only when backups are not just scheduled, but proven and periodically restored.

## Objective

Add repeatable backup/restore checks for PostgreSQL, Redis, and MinIO with automatic freshness validation in reliability artifacts.

## Scope

- `scripts/studiobrain-backup-drill.mjs` (new)
- `studio-brain/docker-compose.yml`
- `studio-brain/scripts/preflight.mjs`
- `scripts/reliability-hub.mjs`

## Tasks

1. Add backup jobs for:
   - PostgreSQL `pg_dump` and optional `pg_dumpall`
   - Redis snapshot (`BGSAVE` + metadata capture)
   - MinIO object listing + bucket integrity test artifact
2. Add restore drill script:
   - restore into ephemeral/local containers
   - validate key application datasets and sanity queries
3. Add freshness policy:
   - backup age thresholds by service
   - warning/escalation path in heartbeat
4. Add artifact output:
   - `output/backups/<timestamp>/manifest.json`
   - restore validation summary
5. Add command surface:
   - `npm run backup:verify`
   - `npm run backup:restore:drill`

## Acceptance Criteria

1. Restore drill can run from current backup set without manual ad-hoc steps.
2. Missing/failing freshness conditions are surfaced in reliability outputs.
3. Backup artifacts are stored with bounded retention and checksum manifest.
4. Drill execution is documented as part of operational readiness checks.

## Dependencies

- `studio-brain/docker-compose.yml`
- `studio-brain/src/data`
- `scripts/reliability-hub.mjs`

## Definition of Done

- Backup creation and restore verification have repeatable commands and documented pass/fail thresholds.

## Work completed

- Added `scripts/studiobrain-backup-drill.mjs` with deterministic command surface:
  - `npm run backup:verify`
  - `npm run backup:verify:freshness`
  - `npm run backup:restore:drill`
- Implemented readiness probes for Postgres/Redis/MinIO and freshness thresholds for backup artifacts.
- Added artifact outputs:
  - `output/backups/<timestamp>/manifest.json`
  - `output/backups/<timestamp>/manifest.sha256`
  - `output/backups/<timestamp>/restore-drill-summary.json`
  - `output/backups/latest.json`
- Wired backup freshness into gates:
  - `scripts/reliability-hub.mjs` warning check
  - `scripts/pr-gate.mjs` warning check
- Updated operational docs:
  - `docs/EMULATOR_RUNBOOK.md`
  - `studio-brain/docs/SWARM_BACKEND_SETUP.md`

## Evidence

1. `npm run backup:verify -- --json`
2. `npm run backup:verify:freshness`
3. `npm run backup:restore:drill -- --json`
4. `npm run reliability:once -- --json`
