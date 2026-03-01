# P1 — Workshops: Request Intake and Demand Routing

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Program Ops + Staff Operations
Type: Ticket
Parent Epic: tickets/P1-EPIC-17-workshops-experience-and-community-signals.md

## Problem

Members have no structured way to ask for workshop topics, and staff lacks a clean demand pipeline.

## Objective

Add workshop request workflows that capture demand and route it into staff planning.

## Scope

1. Member request form for desired workshop topics.
2. Structured fields: technique, level, schedule preference, confidence/intent.
3. Staff triage queue and deduped demand clustering.

## Tasks

1. Define request schema and validation rules.
2. Build member request submission UI and confirmation flow.
3. Build staff triage list with grouping and priority indicators.
4. Add status lifecycle (`new`, `reviewing`, `planned`, `scheduled`, `declined`).

## Acceptance Criteria

1. Members can submit a request in under 2 minutes.
2. Staff can triage requests without manual data wrangling.
3. Similar requests auto-cluster by technique/topic.
4. Request status can be communicated back to members.

## Implementation Log

1. Added in-page workshop request intake form to `web/src/views/EventsView.tsx`.
2. Captures structured fields: technique/topic, level, schedule preference, notes.
3. Routes submissions into existing `supportRequests` intake with `category: Workshops` using a rules-compatible payload.
4. Added local request ledger persistence keyed by member UID for lifecycle tracking (`new`, `reviewing`, `planned`, `scheduled`, `declined`).
5. Added staff triage queue with:
   - Technique/topic clustering
   - Priority scoring
   - Cluster-level and item-level lifecycle controls
6. Added member-facing request tracker card showing latest request states and ticket references.
7. Added request/triage styling in `web/src/views/EventsView.css`.
8. Added export action for a demand brief artifact to support staff programming meetings.

## Validation

1. `npm --prefix web run build` passes.
2. `npm --prefix web run test -- src/utils/studioBrainHealth.test.ts src/views/NotificationsView.test.tsx` passes (no regressions introduced in current targeted suite).
