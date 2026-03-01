# P1 — Staff Console: Batch Artifact Triage and Safe Cleanup

Status: Completed
Date: 2026-02-27
Priority: P1
Owner: Staff Console + Data Integrity
Type: Ticket
Parent Epic: tickets/P1-EPIC-15-staff-console-usability-and-signal-hardening.md

## Problem

Staff identified approximately 80 suspicious batch artifacts that may represent stale, duplicate, or invalid records. Cleanup must be careful, auditable, and reversible to avoid destructive errors.

## Objective

Create an operator-safe triage and cleanup path for suspicious batch artifacts that reduces noise while protecting valid historical and operational data.

## Scope

1. Inventory and classification workflow for suspicious batch artifacts.
2. Safe cleanup controls (dry-run, confirmation, and audit trail).
3. Post-cleanup verification and rollback strategy.

## Tasks

1. Produce a triage inventory of the ~80 suspicious artifacts with category labels and confidence.
2. Define cleanup eligibility rules (delete, archive, merge, or retain) and required evidence.
3. Add dry-run output that previews affected records before any destructive action.
4. Require explicit operator confirmation and capture audit metadata for cleanup actions.
5. Validate cleanup results and document rollback/recovery path for mistakes.

## Acceptance Criteria

1. Full suspicious artifact inventory is available with disposition per record.
2. Cleanup can be executed in dry-run mode with clear preview output.
3. Destructive cleanup paths require explicit confirmation and produce audit logs.
4. Post-cleanup checks confirm no valid active/history workflows are broken.
5. Rollback instructions are documented and tested for at least one representative scenario.

## Completion Evidence (2026-02-28)

1. Deterministic triage inventory model implemented in `web/src/views/StaffView.tsx`:
   - Added per-batch classification with `category`, `confidence`, `dispositionHints`, rationale, and risk flags.
   - Added deterministic inventory table for likely artifacts in the Staff > Pieces & batches module.
2. Safe cleanup path implemented in `web/src/views/StaffView.tsx`:
   - Added dry-run cleanup preview payload/log generation (default path, no destructive writes).
   - Added destructive confirmation phrase gate (`DELETE <N> BATCHES`) before destructive payload dispatch.
   - Added audit metadata capture (`operatorUid`, `operatorEmail`, `operatorRole`, run/timestamp, reason code/text, ticket refs, selection scope).
   - Added explicit preview-only fallback when backend cleanup endpoint is unavailable.
3. Offline-safe operator flow added in `scripts/staff-batch-artifact-cleanup.mjs`:
   - Consumes StaffView cleanup payloads and writes an audit artifact.
   - Always preview-only by design; never mutates Firestore data.
4. Staff styling support added in `web/src/App.css`:
   - Added triage confidence pill styling and warning/health note variants used by cleanup/triage UI.
5. Backend cleanup endpoint implemented in `functions/src/index.ts`:
   - Added `staffBatchArtifactCleanup` authenticated staff-only endpoint.
   - Supports preview runs plus guarded destructive archive mode with strict confirmation phrase.
   - Persists run metadata/audit trail in `staffBatchArtifactCleanupRuns` and writes `staffArtifactCleanup` annotations on touched batch docs.

## Post-Completion Notes

1. Destructive mode is intentionally restricted to high-confidence non-active artifacts to reduce accidental data loss.
2. Preview mode remains available for broader cohorts and operational rehearsal.
