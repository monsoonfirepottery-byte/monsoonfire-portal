HANDOFF CAPSULE
1) TASK: E10 Task-03 — Cockpit rollout checklist
2) EPIC: E10 OS Surfaces UI Consolidation
3) MODE: FULL AUTOPILOT EPIC MODE
4) SPECIALIST: Reliability & Diagnostics Specialist
5) DELIVERABLE: CHECKLIST
6) STATUS: COMPLETED
7) FILES: studio-brain/src/http/cockpit.ts

Run this
- node --test studio-brain/lib/http/server.test.js --test-name-pattern "cockpit"

Expect
- single-source payload includes state, proposals, connectors, readiness, audit counts
- stale-state warnings are deterministic and traceable
- endpoint stays read-only and auth gated

3 checks if fail
1) if readiness missing, verify stateStore and connector runtime wiring
2) if proposal list missing, confirm proposal limit and fetch order
3) if payload is noisy, tighten field allowlist in contract

Rollback
- disable endpoint by removing route only; keep projector tests to preserve contract.
