# P2 — Website Runtime Error and Offline Banners

Status: Completed
Date: 2026-02-22
Priority: P2
Owner: Website + Platform
Type: Ticket
Parent Epic: tickets/P1-EPIC-13-reliability-hardening-failure-mode-first-ux.md

## Objective

Add lightweight client-side runtime/offline error surfacing on website scripts where interactive behavior exists.

## Tasks

1. Add reusable website ErrorBanner/ErrorPanel runtime helpers.
2. Show offline banner on network disconnect.
3. Show runtime error banner with support code and reload option.

## Acceptance Criteria

1. Website surfaces no silent script failures for common runtime issues.
2. Messages are calm and non-technical.
3. Recovery actions are visible and safe.
