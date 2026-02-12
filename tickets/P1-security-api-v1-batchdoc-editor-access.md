# P1 — Security: API v1 Batch Doc Reads Must Match Firestore Rules (No Editor Access)

**Status:** Done (2026-02-11)

## Problem
- Firestore rules intentionally restrict reads of `batches/{batchId}` to:
  - staff, or
  - the batch owner
- Editors (`batches/{batchId}.editors`) can read some subcollections via rules, but **not** the batch doc itself (see `tickets/P2-firestore-batch-editors-read.md`).
- `functions/src/apiV1.ts` previously treated `editors` as authorized readers for the batch doc, which meant an editor could call:
  - `POST /apiV1/v1/batches.get`
  and read batch metadata that Firestore rules do not allow them to read.

## Fix
- Updated `functions/src/apiV1.ts` to split authorization:
  - `canReadBatchDoc`: staff OR owner only
  - `canReadBatchTimeline`: staff OR owner OR editor (matches existing rules for timeline/pieces)
- Routes updated:
  - `/v1/batches.get` now uses `canReadBatchDoc`
  - `/v1/batches.timeline.list` uses `canReadBatchTimeline`

## Acceptance
- An editor cannot read `batches/{batchId}` via API v1 unless they are staff.
- Timeline access for editors remains unchanged.
- `npm --prefix functions run build` succeeds.

## How To Test
1. In emulator (or prod if safe), create a batch with an editor UID that is not staff and not owner.
2. As that editor (Firebase ID token), call:
   - `POST /apiV1/v1/batches.get` with `{ "batchId": "<id>" }`
   - Expect `403`.
3. Call:
   - `POST /apiV1/v1/batches.timeline.list` with `{ "batchId": "<id>" }`
   - Expect `200` (if rules intend editors can read timeline).

