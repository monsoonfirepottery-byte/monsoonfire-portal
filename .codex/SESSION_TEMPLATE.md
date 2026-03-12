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
- For `writeScope: codex-docs-only`, keep edits and command surfaces within `.codex` + codex docs runbooks only, unless a scoped strategy change is requested.

## Files likely involved
- web/src/App.tsx
- functions/src/index.ts (or equivalent)
- Firestore indexes/rules if needed
- For `writeScope: codex-docs-only`: `.codex/*.md`, `docs/runbooks/CODEX_AGENTIC_RUBRIC_AND_AUTOPILOT.md`, `docs/runbooks/MCP_OPERATIONS.md`, `docs/runbooks/INTERACTION_MODEL_AND_ESCALATION.md`.

## Command evidence protocol
- On any blocker signal, log in order: command/signature, exit status, first signal line.
- For unchanged `(query + runId)` startup continuity misses, classify blocker-state and apply exactly one unblock action before any retry.
- Treat startup continuity lookup transport/timeout failures with unchanged `(query + runId)` as the same blocker-state.
- Treat startup continuity `401/Missing Authorization header` as the same blocked-state as `missing-auth-token` for unchanged `(query + runId)`.
- For deterministic workflow statuses (`skip`, `duplicate`, `cooldown`, `no-op`) after no mutation, apply only one unblock action before rerun.

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
- Review queue: `proposed/proposed.jsonl`
- Strategic open loop to keep visible: local West Valley/Phoenix studio expansion real-estate tracking.
- On startup context transport failures for unchanged `(query + runId)` signatures (including `spawnSync ... ETIMEDOUT`), treat the state as blocked and do not rerun the same signature.
- For that blocked signature, log blocker evidence in-order (`command`, `exit`, `query`, `runId`, `first signal`) and apply exactly one unblock action before retrying:
  - `--run-id` shift,
  - AM/PM slot defer,
  - or auth/context-path recovery (`open-memory` fallback path).
- Every new Codex shell should start by loading startup memory continuity:
  - Run `startup_memory_context` with:
    - task-specific `query`,
    - stable `runId`,
    - `expandRelationships: true`,
    - `maxHops: 3`.
  - If startup continuity returns `missing-auth-token` or `401` auth errors, record blocker evidence in order (`command`, `exit`, `signal`) and stop identical retries.
  - For repeated startup auth blocks on the same `query + runId` signature, classify as blocked and take one unblock action (`runId` shift, auth token fix, or environment repair) before any broader retry.

## Manual test checklist
- Sign in
- Paste admin token (if required)
- Create batch
- Close batch
- Continue journey
- Verify timeline/history
