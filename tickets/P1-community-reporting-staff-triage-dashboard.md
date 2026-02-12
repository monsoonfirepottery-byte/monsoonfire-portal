# P1 — Staff Reports Queue + Triage Workflow

Status: In Progress

## Context / user story
- As staff, I need a reports queue with filters, details, and resolution actions.

## Acceptance criteria
1. Staff module adds `Reports` screen with table filters:
   - status, category, severity, targetType, date range
2. Report detail view shows:
   - report payload
   - target snapshot
   - timeline/history
   - internal notes
3. Staff actions supported:
   - status updates
   - add internal note
   - content action entrypoint
4. All staff actions write report audit entries.
5. Non-staff users cannot access reports UI/actions.

## Implementation notes
- Extend existing `StaffView` module architecture and troubleshooting trace patterns.
- Keep detail view auditable and append-only for notes/actions history.

## Security considerations
- Staff-only endpoint and UI guards.
- Enforce server-side role checks for every triage mutation.

## Telemetry / audit logs
- Track queue views, filtered views, and actions (`resolve`, `note_add`, `escalate`).

## Dependencies
- `tickets/P1-community-reporting-create-report-endpoint.md`
- staff endpoints (`listReports`, `updateReportStatus`, `addInternalNote`).

## Estimate
- M

## Progress notes
- Implemented `Reports` staff module with filterable queue, detail panel, bulk status updates, and internal notes/actions wiring.
- Added SLA-focused triage mode and keyboard-accessible table row selection.
- Added date-window filtering (`24h`, `7d`, `30d`, `90d`, `all`) across staff report listing.
