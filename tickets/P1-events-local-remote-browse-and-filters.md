# P1 — Events: Local and Remote Browse + Filters

Status: Active
Date: 2026-03-01
Priority: P1
Owner: Frontend + Member Experience
Type: Ticket
Parent Epic: tickets/P1-EPIC-20-events-page-industry-events-local-remote-expansion.md

## Problem

Members do not have a single in-app view for discovering relevant external events by geography and attendance mode.

## Objective

Ship a member-facing industry-events section on the Events page with clear local/remote filters and marquee-event visibility.

## Scope

1. New Industry Events panel in `EventsView`.
2. Filter chips/toggles: `Local`, `Remote`, `Hybrid`, `National`, `This month`, `Next 90 days`.
3. Marquee rail for major events (for example NCECA and top regional conventions).
4. Source-attributed cards with outbound links.

## Tasks

1. Add card/list components for `IndustryEventSummary` rows.
2. Implement filtering and stable sorting (`startAt` ascending, pinned marquee first).
3. Add empty-state guidance and fallback recommendations.
4. Add tracking events for filter usage and outbound click intent.

## Acceptance Criteria

1. Members can identify local opportunities and remote opportunities quickly.
2. Card metadata clearly shows where, when, and source trust context.
3. Mobile and desktop layouts remain readable and tappable.
4. Existing workshop sections remain functional and unchanged.
