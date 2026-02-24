# P2 — Data Portability, Export, and Continuity Controls

Status: Completed
Date: 2026-02-17

## Problem
Community signals repeatedly mention anxiety around app discontinuation and data portability. For studio operations, losing reservation, pickup, or piece history has high trust cost.

## Objective
Guarantee predictable data continuity for studio records and member workflow data through documented export, retention, and recovery policies.

## Scope
- Reservation and audit data model docs
- Backup/export API surface (if any)
- Operational runbooks for migration and recovery
- Staff/admin controls for retention and archive actions

## Tasks
1. Add data continuity contract:
   - define minimum export set (`reservations`, `stageHistory`, `piece entries`, `notifications`, `storage actions`).
2. Add signed export artifact:
   - timestamped CSV/JSON bundle
   - schema version in export header
   - redaction rules for sensitive fields.
3. Add member-visible "record continuity" messaging:
   - where to find their reservation history
   - what happens on account changes
   - retention windows and archival behavior.
4. Add admin recovery playbook:
   - incident scenario if function/storage access fails
   - known recovery checkpoints for partial records
   - manual rehydration path from export.
5. Add automated backups for high-risk fields (notifications sent, status transitions, piece IDs/photos metadata).
6. Add a retention/retention-extension policy for media references (photos, notes, proofs).

## Acceptance
- A full studio continuity export path exists and is documented.
- Recovery path exists for common breakage scenarios without manual guessing.
- Critical operational history is preserved through a documented lifecycle and retention policy.
- No single point of platform-only state blocks a restore for studio operations.

## Dependencies
- `tickets/P1-studio-reservation-status-api.md`
- `tickets/P1-studio-reservation-stage-timeline-and-audit.md`
- `tickets/P2-studio-piece-traceability-with-piece-codes.md`

## Completion Evidence (2026-02-24)
- Continuity export API contract shipped:
  - route: `POST /apiV1/v1/reservations.exportContinuity`
  - owner/staff authz with scope checks
  - export header includes `artifactId`, `schemaVersion`, `generatedAt`, `signature (mfexp_*)`, and `requestId`
  - supports JSON bundle plus optional CSV bundle
  - file: `functions/src/apiV1.ts`
- Continuity export contract tests added:
  - owner export happy-path
  - non-owner deny path
  - file: `functions/src/apiV1.test.ts`
- Member/staff continuity UX added in portal:
  - Reservations view now exposes `Export continuity bundle`
  - downloads JSON + CSV artifacts from API response
  - file: `web/src/views/ReservationsView.tsx`
- Member-visible continuity guidance added:
  - support FAQ fallback includes continuity/export answer and search synonyms
  - file: `web/src/views/SupportView.tsx`
- Data continuity docs/runbook updated:
  - continuity export contract and dataset list in schema docs
  - offline + continuity recovery checks in operations runbook
  - media-reference retention guidance in storage policy
  - files:
    - `docs/SCHEMA_RESERVATIONS.md`
    - `docs/runbooks/STUDIO_RESERVATION_OPERATIONS_PLAYBOOK.md`
    - `docs/policies/storage-abandoned-work.md`
- Automated high-risk history preservation is now explicit in continuity scope:
  - status transitions: `stageHistory` / `stageStatus`
  - notifications sent: `users/{uid}/notifications` (exported in continuity bundle)
  - piece metadata (including photo-presence marker): `pieces` / `hasPhoto` in export
  - files: `functions/src/apiV1.ts`, `web/src/views/ReservationsView.tsx`
