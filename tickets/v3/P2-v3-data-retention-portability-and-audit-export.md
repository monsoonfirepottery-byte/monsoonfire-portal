# P2: Data Retention, Portability, and Audit Export

## Goal
Define retention windows and export paths for local Studio OS artifacts while preserving immutable audit expectations.

## Non-goals
- No legal policy drafting beyond technical controls.
- No deletion of cloud-authoritative business records.

## Acceptance Criteria
- Retention policy matrix exists for snapshots, diffs, events, and proposal records.
- Export command generates signed, verifiable audit bundles (hash manifest).
- Staff can request export from approved UI/CLI path.
- Purge flow only affects local derived stores according to policy windows.

## Files/Dirs
- `docs/policies/STUDIO_OS_V3_RETENTION.md`
- `studio-brain/src/cli/exportAudit.ts`
- `studio-brain/src/jobs/retentionJob.ts`

## Tests
- Unit tests for retention cutoff logic.
- Integration test for export bundle integrity (manifest hash verification).

## Security Notes
- Export includes minimum necessary data; no secret material.
- Access to export/purge operations must be staff-restricted and audited.

## Dependencies
- `P0-v3-studio-brain-scaffold.md`
- `P1-v3-capability-registry-proposal-approval-audit.md`

## Estimate
- Size: M

## Telemetry / Audit Gates
- Events: export requested/generated/downloaded, purge executed/skipped.
- Retention exceptions logged with policy reason code.

## Rollback
- Disable purge job and keep full retention until corrected.
- Keep export command available in read-only verification mode.
