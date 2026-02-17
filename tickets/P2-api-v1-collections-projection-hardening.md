# P2 — API V1 Collection Projection Hardening

Status: Completed

Date: 2026-02-17

Problem
- Several v1 list endpoints still return spread Firestore rows into responses with potentially sensitive/unexpected fields:
  - `/v1/agent.requests.listMine`
  - `/v1/agent.requests.listStaff`
  - `/v1/batches.timeline.list`
  - `/v1/firings.listUpcoming`
- This creates accidental contract drift risk and can expose internal metadata.

Scope
- `functions/src/apiV1.ts`

Tasks
- Add explicit projection/normalization helpers for each list endpoint payload.
- Ensure these payloads return only documented fields and normalize malformed/undefined values to null/defaults.
- Apply redaction or omission for internal fields not intended for clients (if any are confirmed).
- Add tests asserting raw Firestore payload shape changes do not alter response contracts.

Acceptance
- API list endpoints are stable under malformed Firestore document shapes.
- Raw spread operator paths are removed from these response surfaces.
- Regression test suite validates output schemas for the above routes.

Acceptance Notes
- Status: Completed raw spread replacement for `/v1/batches.timeline.list`, `/v1/firings.listUpcoming`, `/v1/agent.requests.listMine`, `/v1/agent.requests.listStaff`.
- Added explicit projection helpers in `functions/src/apiV1.ts`:
  - `toTimelineEventRow`
  - `toFiringRow`
  - `toAgentRequestRow`
- Added regression coverage in `functions/src/apiV1.test.ts`.
