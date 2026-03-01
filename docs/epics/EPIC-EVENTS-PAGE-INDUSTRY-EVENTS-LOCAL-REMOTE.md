# EPIC: EVENTS-PAGE-INDUSTRY-EVENTS-LOCAL-REMOTE

Status: Active
Date: 2026-03-01
Priority: P1
Owner: Program Ops + Member Experience + Community
Type: Epic
Epic Ticket: tickets/P1-EPIC-20-events-page-industry-events-local-remote-expansion.md

## Problem

The Events page is currently optimized for in-studio programming and workshop operations, but members do not have a reliable way to discover broader ceramic industry opportunities (local/regional conventions, national gatherings, remote summits, and announced partner events).

## Objective

Expand the Events page into a trusted discovery surface for both local and remote industry events so members can track meaningful opportunities like NCECA, regional clay conventions, and other relevant programs in one place.

## Scope

1. New industry-events domain model separate from workshop checkout/signup data.
2. Member-facing local/remote event browse with clear filters and event type labeling.
3. Staff curation workflow for source review, promotion, and expiry handling.
4. Event-quality guardrails (freshness, source attribution, duplicate prevention).
5. Calendar/reminder utilities for member follow-through.
6. QA and canary coverage for listing reliability and stale-content regressions.

## Decision Log

1. Keep `industryEvents` separate from existing workshop `events` documents to avoid payment and attendance contract coupling.
2. V1 focuses on discovery + outbound routing (no native checkout for external events).
3. Every event card must include source attribution and `verifiedAt` metadata.
4. Expired events are hidden from default browse but retained for audit/analytics windows.

## Tasks

1. Define industry-events schema and API contract (local, remote, hybrid, source metadata, quality state).
2. Ship member browse/filter experience for local + remote events in the Events page.
3. Ship staff curation and publishing workflow with source checks.
4. Add sourcing automation and freshness checks.
5. Add calendar export/reminder hooks.
6. Add runbook + smoke/canary guardrails.

## Acceptance Criteria

1. Members can browse upcoming events by local/remote/hybrid with clear metadata.
2. Marquee events (for example NCECA and regional conventions) can be curated and surfaced prominently.
3. Staff can review, approve, and retire events without code changes.
4. Events older than policy thresholds are flagged or hidden automatically.
5. Source attribution and verification timestamps are visible and auditable.
6. Smoke/canary checks catch empty-feed, stale-feed, and malformed-card regressions.

## Child Tickets

- tickets/P1-EPIC-20-events-page-industry-events-local-remote-expansion.md
- tickets/P1-events-industry-feed-contract-and-normalization.md
- tickets/P1-events-local-remote-browse-and-filters.md
- tickets/P1-events-staff-curation-source-review-and-publishing.md
- tickets/P2-events-sourcing-connectors-and-freshness-automation.md
- tickets/P2-events-calendar-export-and-reminder-paths.md
- tickets/P2-events-qa-runbook-and-canary-regression-gate.md
