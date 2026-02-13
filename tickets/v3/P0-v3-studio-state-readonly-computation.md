# P0: Read-only StudioState Computation (Firestore + Stripe Reads)

## Goal
Compute daily StudioState snapshots from cloud-authoritative reads and persist locally in Postgres.

## Non-goals
- No authoritative writes to Firestore/Stripe.
- No policy execution or connector writes.

## Acceptance Criteria
- `computeStudioState` reads Firestore entities relevant to operations and computes counts.
- Stripe input is read-only and safe (or stubbed via cloud summary path in P0).
- Snapshot schema is versioned (`v3.0`) and stored in `studio_state_daily`.
- Diff generation persists changed fields in `studio_state_diff`.
- Local state can be recomputed without manual data edits.

## Files/Dirs
- `studio-brain/src/studioState/compute.ts`
- `studio-brain/src/cloud/firestoreReader.ts`
- `studio-brain/src/cloud/stripeReader.ts`
- `studio-brain/src/jobs/studioStateJob.ts`

## Tests
- Unit tests for snapshot mapping and diff behavior.
- Job test validates persistence path and audit append behavior.

## Security Notes
- Cloud remains source of truth.
- Local snapshot is derived only and includes source hashes/timestamps.
- No local secret fan-out to agents.

## Dependencies
- `P0-v3-studio-brain-scaffold.md`
- Firestore read permissions for service principal.

## Estimate
- Size: M

## Telemetry / Audit Gates
- Snapshot compute event includes snapshot date and source timestamps.
- Diff generation includes changed field count.
- Read failures include error class without leaking sensitive payloads.

## Rollback
- Disable scheduled StudioState job.
- Keep existing portal staff dashboards as operational fallback.
