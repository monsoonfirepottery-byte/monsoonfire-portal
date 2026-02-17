# Portal polish: engagement + clarity

Status: Completed
Priority: P3
Severity: Sev4
Component: portal
Impact: med
Tags: polish, ux, clarity, engagement

## Problem statement
The core portal flows are functional, but key moments still feel transactional and sparse. Empty states and transition moments do not clearly tell members what to do next, which can reduce confidence and repeat engagement.

## Proposed solution
Implement lightweight UX polish in existing views without new dependencies:
- improve empty states with explicit guidance + single CTA
- add “what happens next” style microcopy where users hesitate
- add relative update context in high-traffic lists
- preserve all existing safety rails (in-flight guards, troubleshooting, error boundaries)

## Acceptance criteria
- Empty states in My Pieces provide actionable guidance and no dead-ends.
- At least one primary portal flow feels more guided with no behavior regressions.
- CTA buttons remain disabled correctly while in-flight actions run.
- No blank-screen regressions.

## Manual test checklist
1. Sign in with a user that has no history and verify first-run empty guidance appears.
2. Switch to Active-only and verify “nothing in flight” guidance appears.
3. Click CTA from empty state and confirm expected navigation/action opens.
4. Confirm continue journey and archive/restore actions still work.
5. Verify troubleshooting panel still renders request metadata when available.

## Notes for iOS parity (SwiftUI portability)
- Keep state guidance text deterministic and based on simple counts.
- Avoid browser-only dependencies for core decision logic.
- Keep CTA intent explicit so SwiftUI can map to equivalent button actions.

## Completion notes (2026-02-12)
- Implemented empty-state upgrade in `web/src/views/MyPiecesView.tsx` with guided copy and single CTA (`Open Ware Check-in` / `Start check-in`).
- Preserved existing in-flight guards and troubleshooting behavior.
