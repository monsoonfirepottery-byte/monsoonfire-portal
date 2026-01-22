# Timeline Event Migration Plan

Date: 2026-01-21
Owner: TBD
Status: Ready

## Goal
Normalize legacy timeline event types in Firestore so all clients see canonical event labels.

## Legacy → Canonical mapping
- `BATCH_CREATED` → `CREATE_BATCH`
- `SUBMITTED` → `SUBMIT_DRAFT`
- `PICKED_UP_AND_CLOSED` → `PICKED_UP_AND_CLOSE`

## Tooling
Admin-only Cloud Function:
- `normalizeTimelineEventTypes`
- Requires:
  - `Authorization: Bearer <ID_TOKEN>`
  - `x-admin-token: <ADMIN_TOKEN>`

## Usage

### 1) Dry run (no writes)
Request body:
```json
{
  "dryRun": true,
  "limit": 200
}
```

### 2) Target a single batch (optional)
```json
{
  "batchId": "<BATCH_ID>",
  "dryRun": false
}
```

### 3) Full pass (collectionGroup)
Run in chunks to avoid timeouts:
```json
{
  "dryRun": false,
  "limit": 200
}
```
Repeat until `matched` returns `0`.

## Expected response
- `matched`: number of legacy events found
- `wouldUpdate`: number of events that would be updated
- `updated`: number of events updated (0 in dryRun)
- `sample`: small preview of updates

## Notes / pitfalls
- If you see `FAILED_PRECONDITION`, create the index from the error link in Firebase console.
- The function only updates the `type` field; no other fields are touched.
- Run during low-traffic windows if you expect many updates.
