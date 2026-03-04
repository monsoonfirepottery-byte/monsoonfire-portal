# P1 — Library Frontend: Functional Browse and Selection UX Path

Status: In Progress
Date: 2026-03-01
Priority: P1
Owner: Frontend UX + Member Experience
Type: Ticket
Parent Epic: tickets/P1-EPIC-16-lending-library-experience-and-learning-journeys.md

## Problem

The library UI currently risks over-emphasizing metadata chiplets and secondary signals, which increases cognitive load and slows member selection decisions.

## Objective

Deliver a functionality-first browsing and selection flow that helps members quickly choose what to borrow/read, with calm hierarchy and progressive disclosure.

## Reference Direction

Use browsing/selection interaction patterns inspired by:
1. Goodreads: cover-first scanning and list-to-detail progression.
2. Amazon: strong product detail hierarchy and clear decision affordances.
3. Studio constraint: preserve Monsoon Fire visual identity; do not clone external visual style.

## Internal A/B Decision (2026-03-01)

1. Variant A:
   1. Metadata-forward cards with denser chiplet usage.
   2. Fully expanded filter controls.
   3. Faster access to edge metadata at the cost of visual noise.
2. Variant B:
   1. Cover-first cards with strict primary-field hierarchy.
   2. Collapsible/quiet filter panel.
   3. Progressive detail expansion for secondary and advanced metadata.
3. Internal scoring (1-5, higher is better):
   1. Time to confident selection: A=3, B=5.
   2. Mobile scan legibility: A=2, B=5.
   3. Metadata depth recoverability: A=4, B=4.
   4. Staff ISBN workflow error resistance: A=2, B=5.
   5. Total: A=11, B=19.
4. Decision: Variant B.
5. Why: better browse-to-selection speed, lower cognitive load, and better mobile legibility while keeping deep filters available on demand.

## Scope

1. Reduce chiplet density in catalog cards and detail headers.
2. Elevate core decision fields: cover, title, author, availability, rating summary, and action.
3. Move deep metadata into expandable panels/tabs.
4. Keep filter controls powerful but visually quiet.
5. Preserve mobile ergonomics and accessibility.

## Tasks

1. Audit current Lending cards/detail UI and classify fields into `primary`, `secondary`, `advanced`.
2. Redesign card layout to show only primary fields above the fold.
3. Convert secondary metadata chiplets into grouped text rows or compact badges with strict limits.
4. Move advanced metadata to expandable sections in detail view.
5. Add UX guardrails: maximum visible chiplet count per card/detail header.
6. Validate browse-to-action flow on mobile and desktop.
7. Run usability pass focused on “time to confident selection”.
8. Implement the selected Variant B workflow and remove deprecated Variant A patterns from default surfaces.

## Acceptance Criteria

1. Card surfaces remain readable at a glance without chiplet clutter.
2. Members can identify availability and next action without opening detail view.
3. Detail pages present advanced metadata progressively, not all at once.
4. Mobile browsing remains fast and legible with no horizontal overflow.
5. Accessibility and performance are maintained or improved from baseline.
6. Variant B is the shipped default path and is documented in epic execution notes.

## Execution Update (2026-03-01, Deep Pass)

Completed in this pass:
1. Added a human-centered detail action bar in `web/src/views/LendingLibraryView.tsx` that keeps primary next actions explicit:
   - reserve / waitlist,
   - return request when currently borrowed,
   - availability notification toggle.
2. Added contextual action guidance text in detail view so members can understand the current state without scanning multiple panels.
3. Added active filter/search state summary and direct reset control in browse header to reduce decision fatigue during deep filtering.
4. Added mobile sticky behavior for detail action bar in `web/src/views/LendingLibraryView.css` so primary actions stay reachable while reviewing metadata.
