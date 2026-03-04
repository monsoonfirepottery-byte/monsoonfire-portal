# P1 — Lending Library: Technique <-> Workshop Pathway

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Program Ops + Library Ops
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Members cannot easily connect what they read to classes they can take, and staff cannot capture demand for new workshops based on library interest.

## Objective

Create a two-way pathway between techniques, workshops, and books:
1. Workshop -> techniques/books for deeper study.
2. Technique/book -> workshop discovery or workshop request when none exists.

## Scope

1. Technique metadata model for books and workshops.
2. Related-technique and related-workshop UI surfaces.
3. Member request flow for desired workshops by technique.
4. Staff triage view for technique demand backlog.

## Tasks

1. Add canonical technique tags and mappings for library items and workshops.
2. Render workshop cards from technique/book pages and library cards from workshop pages.
3. Add "Request workshop for this technique" flow with structured fields.
4. Add staff list/filter for incoming technique workshop requests.

## Acceptance Criteria

1. Members can discover workshops from a technique/book context in <=2 clicks.
2. Members can submit a workshop request when no match exists.
3. Staff can review demand grouped by technique and signal frequency.
4. Technique mappings are reusable across Lending, Workshops, and Staff modules.

## Completion Evidence (2026-02-28)

1. Added technique-aware item metadata support (`techniques`, `relatedWorkshops`) in `web/src/types/library.ts` and `web/src/lib/normalizers/library.ts`.
2. Added Lending detail UI for technique chips and related workshop links with telemetry (`lending_workshop_link_opened`) in `web/src/views/LendingLibraryView.tsx`.
3. Implemented "Request workshop for this technique" flow from Lending detail into `supportRequests` with structured technique/level/schedule fields in `web/src/views/LendingLibraryView.tsx`.
4. Added interaction telemetry for pathway engagement (`lending_workshop_request_submitted`, `prefill_technique` actions) in `web/src/views/LendingLibraryView.tsx` to support staff demand triage inputs.
