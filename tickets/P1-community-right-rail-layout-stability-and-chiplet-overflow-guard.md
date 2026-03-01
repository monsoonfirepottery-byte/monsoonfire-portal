# P1 — Community Right Rail Layout Stability and Chiplet Overflow Guard

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Frontend
Type: Ticket
Parent Epic: tickets/P1-EPIC-18-community-page-experience-and-layout-resilience.md

## Problem

Right-rail content can shift or clip under async loading, especially around report-status chiplets and dynamic labels.

## Objective

Harden Community right-rail CSS so async updates do not push content off-center or overflow chiplets.

## Tasks

1. Add explicit min-width/overflow behavior for right-rail cards and rows.
2. Allow report row heads to wrap safely while preserving readability.
3. Constrain chiplets/badges to no-clip behavior for dynamic statuses.
4. Confirm desktop/mobile rendering parity for key cards.

## Acceptance Criteria

1. No horizontal clipping in right-rail rows and chiplets after refresh.
2. Dynamic report/video labels wrap or truncate safely without layout breakage.
3. Right-rail width stays stable during async load cycles.

## Completion Evidence (2026-02-28)

1. Added explicit `min-width`, wrapping, and overflow guards for Community right-rail rows/chiplets in `web/src/views/CommunityView.css`.
2. Hardened report-row heading/chiplet behavior for async content by enforcing safe wrap/overflow handling.
3. Updated Community layout structure in `web/src/views/CommunityView.tsx` to keep sidebar sizing stable during refresh cycles.
