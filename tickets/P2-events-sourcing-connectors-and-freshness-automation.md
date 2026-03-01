# P2 — Events: Sourcing Connectors and Freshness Automation

Status: Active
Date: 2026-03-01
Priority: P2
Owner: Platform + Automation
Type: Ticket
Parent Epic: tickets/P1-EPIC-20-events-page-industry-events-local-remote-expansion.md

## Problem

Manual updates alone are not durable for broad industry-event coverage.

## Objective

Add controlled ingestion paths and freshness checks so industry-event listings stay timely and trustworthy.

## Scope

1. Controlled connectors/import paths (RSS/ICS/curated feed inputs).
2. Normalization + dedupe before publish queue.
3. Freshness job to flag stale/unverified events.
4. Error report artifact for failed rows.

## Tasks

1. Implement import adapter interface and one baseline source connector.
2. Add dedupe strategy (`sourceUrl`, normalized title/date hash).
3. Add periodic freshness audit command and artifact output.
4. Wire guardrail check into existing automation matrix where appropriate.

## Acceptance Criteria

1. Connector-ingested rows land in draft/triage state, not auto-published.
2. Duplicate event rows are suppressed deterministically.
3. Stale events are flagged within policy SLA.
4. Import/freshness failures produce actionable artifacts.
