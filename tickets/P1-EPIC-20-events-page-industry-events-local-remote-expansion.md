# P1 — EPIC 20: Events Page Industry Events (Local + Remote) Expansion

Status: Active
Date: 2026-03-01
Priority: P1
Owner: Program Ops + Member Experience + Community
Type: Epic Ticket
Parent Epic: docs/epics/EPIC-EVENTS-PAGE-INDUSTRY-EVENTS-LOCAL-REMOTE.md

## Problem

Members currently need to leave the portal and manually hunt for relevant pottery/ceramics events (local and remote), which reduces discovery quality and participation momentum.

## Objective

Deliver a trusted industry-events lane inside the Events page with curated local and remote opportunities, including major US events and high-quality partner/community announcements.

## Scope

1. Industry-events contract and storage model.
2. Member browse/filter experience.
3. Staff curation workflow and source-quality controls.
4. Freshness automation, calendar utility, and QA coverage.

## Tasks

1. Deliver all child tickets in this epic.
2. Keep workshop checkout/signups decoupled from external industry-event cards.
3. Validate desktop + mobile behavior and source attribution requirements.
4. Ensure stale-event behavior is deterministic and documented.

## Acceptance Criteria

1. Child tickets ship without regressing existing workshop flows.
2. Industry events are discoverable by local/remote intent in under two interactions.
3. Staff can curate and retire events with clear audit metadata.
4. Freshness and card-shape regressions are covered by automated checks.

## Child Tickets

- tickets/P1-events-industry-feed-contract-and-normalization.md
- tickets/P1-events-local-remote-browse-and-filters.md
- tickets/P1-events-staff-curation-source-review-and-publishing.md
- tickets/P2-events-sourcing-connectors-and-freshness-automation.md
- tickets/P2-events-calendar-export-and-reminder-paths.md
- tickets/P2-events-qa-runbook-and-canary-regression-gate.md
