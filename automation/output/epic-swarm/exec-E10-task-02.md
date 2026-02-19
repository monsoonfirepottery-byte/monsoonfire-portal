HANDOFF CAPSULE
1) TASK: E10 Task-02 — Unified cockpit endpoint
2) EPIC: E10 OS Surfaces UI Consolidation
3) MODE: FULL AUTOPILOT EPIC MODE
4) SPECIALIST: Integrations/Data
5) DELIVERABLE: PATCH
6) STATUS: COMPLETED
7) FILES: studio-brain/src/http/server.ts, studio-brain/src/http/server.test.ts

Task statement:
Add `GET /api/cockpit/overview` and wire it to the shared projector.

Files to touch:
- studio-brain/src/http/server.ts
- studio-brain/src/http/server.test.ts

Steps:
1. Fetch latest state, proposals, connector health, recent trust/policy/reconcile audit events.
2. Return one deterministic overview payload.
3. Add integration test asserting keys and stale-state fallback.

Verification:
- npm run --prefix studio-brain build
- node --test studio-brain/lib/http/server.test.js --test-name-pattern "cockpit"

Rollback:
- revert only the new cockpit route and reuse older dashboard endpoints.
