# P1 — Lending Library: Member Learning Signals and Reviews

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Member Experience + Data/Insights
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

Lending lacks useful feedback loops that help members choose the right title and help staff understand educational impact.

## Objective

Capture lightweight, practical learning signals that improve recommendations and programming decisions.

## Scope

1. Practical reviews (difficulty, best-for, value).
2. "Inspired by this book" outcome snippets.
3. Demand signals and engagement events for analytics.

## Tasks

1. Add structured review schema focused on practical usefulness.
2. Add optional post-loan reflection prompt and project outcome field.
3. Surface summarized member signals on library cards/detail pages.
4. Feed anonymized signal aggregates into staff insights.

## Acceptance Criteria

1. Members can submit concise practical reviews in under 1 minute.
2. Review data improves browse confidence (displayed in-card or detail view).
3. Staff can see aggregate demand/impact insights for content planning.
4. Signal collection does not block core reserve/return flow.

## Completion Evidence (2026-02-28)

1. Added a sub-minute "45-second practical review" form in Lending detail with practical value, difficulty, best-for, and optional inspired-by reflection (`web/src/views/LendingLibraryView.tsx`).
2. Added `libraryReviews` read/write flow and client aggregation model so review summaries surface in cards and detail (`web/src/views/LendingLibraryView.tsx`).
3. Extended library types + normalizers for reusable review summary metadata (`reviewSummary`) in `web/src/types/library.ts` and `web/src/lib/normalizers/library.ts`.
4. Added telemetry for signal engagement (`lending_review_submitted`, section action/open events) without blocking reserve/waitlist/return flows in `web/src/views/LendingLibraryView.tsx`.
