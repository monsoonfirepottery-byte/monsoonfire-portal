# Codex Session — Monsoon Fire Portal

## Session goal
(One sentence: what are we shipping/fixing?)

## Current symptom / user-visible issue
- What broke?
- Exact error text (if any):
- When did it start?

## Constraints (do not violate)
- Web app is stepping stone to iOS: explicit JSON contracts, thin UI logic.
- Firestore rejects undefined values.
- continueJourney requires `{ uid, fromBatchId }` + Authorization header.
- Dev-only admin token header: `x-admin-token` (user provided).

## Files likely involved
- web/src/App.tsx
- functions/src/index.ts (or equivalent)
- Firestore indexes/rules if needed

## Repro steps
1)
2)
3)

## Expected behavior
-

## Proposed change (tiny plan)
1)
2)
3)

## Manual test checklist
- Sign in
- Paste admin token (if required)
- Create batch
- Close batch
- Continue journey
- Verify timeline/history
