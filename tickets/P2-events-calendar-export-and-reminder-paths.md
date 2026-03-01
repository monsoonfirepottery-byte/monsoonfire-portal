# P2 — Events: Calendar Export and Reminder Paths

Status: Active
Date: 2026-03-01
Priority: P2
Owner: Frontend + Member Experience
Type: Ticket
Parent Epic: tickets/P1-EPIC-20-events-page-industry-events-local-remote-expansion.md

## Problem

Discovery without follow-through tools lowers attendance conversion for members.

## Objective

Add lightweight follow-through actions so members can save high-interest events and move them to personal calendars.

## Scope

1. "Add to calendar" links (`.ics`, Google Calendar URL template).
2. Member save/bookmark indicator for high-interest events.
3. Reminder-friendly metadata surfaced on event cards/details.
4. Basic engagement telemetry for follow-through actions.

## Tasks

1. Add utility builders for calendar links with timezone-safe fields.
2. Add save/bookmark state handling for signed-in members.
3. Add reminder copy and optional "coming soon" signals.
4. Add analytics events for save/export actions.

## Acceptance Criteria

1. Members can export an event to personal calendar in one click.
2. Saved events are persistent and recover on refresh.
3. Calendar links correctly reflect event timezone and duration.
4. No regressions to existing Events page workflows.
