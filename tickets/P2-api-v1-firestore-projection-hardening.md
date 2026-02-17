# P2 — API v1 Firestore Projection Hardening

Status: Done

## Problem
Several v1 responses rely on spreading full Firestore documents (especially batch/timeline/firing related paths), which can leak unexpected fields and expose unstable shapes.

## Tasks
- Add explicit projection helpers for API responses that expose batch-like and timeline-like payloads:
  - `/v1/batches.list`
  - `/v1/batches.get`
  - `/v1/batches.timeline.list`
  - `/v1/firings.listUpcoming`
  - other agent commerce/read endpoints where docs are returned through spread.
- Normalize payload fields to explicit nullability, strip `undefined`, and enforce expected scalar types.
- Add tests ensuring malformed documents do not alter response envelope contracts.

## Acceptance
- Response contracts for targeted endpoints include only explicit documented fields.
- Malformed/missing document fields are converted to null/defaults rather than leaking raw structures.
- Snapshot regression tests lock stable response shapes.

### Completed
- `functions/src/apiV1.ts` now uses projection helpers for batch/timeline/firing/request list endpoints and strips undefined values from batch detail rows.
- Added `functions/src/apiV1.test.ts` coverage for malformed document fields and projection stability.

## References
- `functions/src/apiV1.ts`
