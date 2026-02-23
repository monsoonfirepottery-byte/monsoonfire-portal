# Firestore Index Troubleshooting

## When to use this

Use this runbook when the portal shows:

- "A required database index is missing or still building"
- Firestore `FAILED_PRECONDITION` errors referencing an index
- Query failures after shipping a new `where(...) + orderBy(...)` pattern

## Steps

1. Capture the support code shown in the portal error banner.
2. Open browser devtools and copy the exact Firestore error (it usually contains a console link).
3. Create the requested composite index in Firebase console (or update `firestore.indexes.json` if this is expected for source control).
4. Wait for index build completion.
5. Retry the portal action.

## Known batch query indexes

The portal batch views require indexes for:

- `ownerUid == <uid>`, `isClosed == false`, ordered by `updatedAt desc`
- `ownerUid == <uid>`, `isClosed == true`, ordered by `closedAt desc`

## Evidence for QA

- Screenshot of the original error with support code
- Firebase index definition or console link
- Screenshot/video of successful retry after index build
