# P1 — Lending Library: Reactive Discovery and Staff Curation

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Member Experience + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Members see a flat catalog and miss high-value content that could deepen technique and retention.

## Objective

Add reactive discovery rails and staff-curated shelves that make the library feel alive and personally relevant.

## Scope

1. Recommended next read (member-context aware).
2. Staff picks with short rationale.
3. Technique retrospectives for older high-value books.
4. New releases recommended by staff.

## Tasks

1. Define content blocks and ranking/prioritization rules.
2. Implement reusable section components for recommendation and curation rails.
3. Add staff content-entry fields for recommendation rationale and shelf placement.
4. Track engagement metrics per section.

## Acceptance Criteria

1. Lending view includes at least 3 dynamic discovery sections.
2. Staff can curate and annotate featured books without code changes.
3. Members can jump from recommendation to reserve/request in one flow.
4. Section-level engagement telemetry is captured.

## Completion Evidence (2026-02-28)

1. Added 4 dynamic discovery rails in `web/src/views/LendingLibraryView.tsx`: `recommended_next_read`, `staff_picks`, `technique_retrospectives`, and `new_releases`.
2. Staff curation fields are now consumed from item metadata (`curation.staffPick`, `curation.staffRationale`, `curation.shelf`, `curation.shelfRank`) via `web/src/types/library.ts` and `web/src/lib/normalizers/library.ts`.
3. Rail cards support direct reserve/waitlist flow through existing request actions (same core flow as catalog cards) in `web/src/views/LendingLibraryView.tsx`.
4. Section-level telemetry hooks were added using `track` with local fallback capture (`lending_section_impression`, `lending_section_action`) in `web/src/views/LendingLibraryView.tsx`.
