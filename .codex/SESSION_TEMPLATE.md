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
- Default collaboration mode is high-autonomy execution until blocker.

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

## Memory context (load at session start)
- Durable memory root: `C:\Users\micah\.codex\memory`
- Read first: `accepted/accepted.jsonl`
- Review queue: `working/proposed_review_queue.md`
- Strategic open loop to keep visible: local West Valley/Phoenix studio expansion real-estate tracking.

## Manual test checklist
- Sign in
- Paste admin token (if required)
- Create batch
- Close batch
- Continue journey
- Verify timeline/history
