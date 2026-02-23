# P2 — Incident Bundle Automation for Studiobrain Diagnostics

Status: Completed
Date: 2026-02-18
Priority: P2
Owner: QA + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-07-studiobrain-cutover-from-wuff-laptop-to-studiobrain.md

## Problem

Incident response depends on manually collecting environment, logs, and health state, increasing time-to-recovery.

## Objective

Create a single command that composes a ready-to-share diagnostics bundle for any incident window.

## Scope

- `scripts/studiobrain-incident-bundle.mjs` (new)
- `scripts/reliability-hub.mjs`
- `studio-brain/scripts/preflight.mjs`
- `docs/incident-response/` (new folder or docs extension)

## Tasks

1. Add bundle command:
   - `npm run incident:bundle`
   - include status, uptime, dependencies, host profile, and artifact references
2. Add collected artifacts:
   - config snapshot + resolved contract
   - recent logs (bounded)
   - health checks + heartbeat summary
   - git metadata and local git diff summary
3. Add bundling guardrails:
   - redact secrets and tokens
   - deterministic filename and checksum
4. Add output format:
   - `output/incidents/<timestamp>/bundle.json`
   - `output/incidents/<timestamp>/bundle.tar.gz`
5. Add quick-share section in docs: how to attach bundle to triage channels.

## Acceptance Criteria

1. Bundle generation is one command and succeeds in under 30 seconds.
2. Bundle includes all common troubleshooting inputs for common incidents.
3. Secrets and sensitive fields are never emitted raw.
4. Incident runbook references the generated bundle and expected triage flow.

## Dependencies

- `scripts/reliability-hub.mjs`
- `studio-brain/scripts/preflight.mjs`
- `docs/EMULATOR_RUNBOOK.md`

## Definition of Done

- Incident bundle command is available and documented with explicit postmortem handoff instructions.

## Work completed

- Added incident bundle command:
  - `scripts/studiobrain-incident-bundle.mjs`
  - `npm run incident:bundle`
- Bundle now captures:
  - network check, status card, integrity report
  - heartbeat summary/events
  - bounded git metadata and artifact pointers
- Added redaction pass for sensitive fields before write.
- Added deterministic output formats:
  - `output/incidents/<timestamp>/bundle.json`
  - `output/incidents/<timestamp>/bundle.sha256`
  - `output/incidents/<timestamp>/bundle.tar.gz`
  - `output/incidents/latest.json`
- Wired reliability hub to auto-capture incident bundles on critical failures.

## Evidence

1. `npm run incident:bundle -- --json`
2. `npm run reliability:once -- --json` (critical-failure capture path)
