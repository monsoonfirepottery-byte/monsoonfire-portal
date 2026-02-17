# P1 — Community Reporting Foundation

Status: Completed

## Context / user story
- As a portal member, I need a simple way to report problematic community content.
- As staff, I need a trustworthy queue to triage and resolve reports with clear audit trails.

## Acceptance criteria
1. Reporting architecture and data model are documented for current target types (`youtube_video`, `blog_post`, `studio_update`, `event`).
2. Cloud Functions contract for `createReport`, `listReports`, `updateReportStatus`, `addInternalNote`, `takeContentAction` is documented.
3. Firestore schema and rules approach are defined with staff-only fields and audit collections.
4. Tracker links to downstream implementation tickets for UI, backend, security, and tests.

## Implementation notes
- Foundation ticket only: architecture, contracts, and backlog alignment.
- No broad feature implementation in this ticket.

## Security considerations
- Define canonical enforcement in Cloud Functions for validation/rate limit/dedupe/snapshot capture.
- Document immutable audit requirements.

## Telemetry / audit logs
- Define required event names and required fields for create report + staff actions.

## Dependencies
- None.

## Estimate
- S

## Progress notes
- Added architecture + schema + contract doc:
  - `docs/COMMUNITY_REPORTING_ARCHITECTURE.md`
- Reporting function contracts are implemented in `functions/src/reports.ts` and exported via `functions/src/index.ts`.
- Firestore rules strategy and moderation/audit collections are in place in `firestore.rules`.
