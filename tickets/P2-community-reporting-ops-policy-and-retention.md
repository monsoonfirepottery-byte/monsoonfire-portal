# P2 — Reporting Ops Policy, Abuse Playbook, and Retention

Status: Completed

## Context / user story
- As operators, we need clear policy + retention + incident response for report abuse and escalations.

## Acceptance criteria
1. Policy doc covers report categories, severity handling SLA, and escalation path.
2. Incident response playbook includes:
   - emergency content disable path
   - user-safety escalation path
   - communication templates
3. Data retention policy defined for reports and report audit logs.
4. Scheduled retention task plan documented (archive/delete windows).

## Implementation notes
- Align with existing staff/system governance docs and runbooks.
- Keep retention conservative for safety investigations.

## Security considerations
- Restrict retention job permissions to service roles only.
- Preserve forensic integrity of audit timelines.

## Telemetry / audit logs
- Emit retention-job summary logs and incident action logs with actor/time/reason.

## Dependencies
- `tickets/P1-community-reporting-staff-triage-dashboard.md`
- `tickets/P1-community-reporting-rules-and-security-tests.md`

## Estimate
- S

## Completion Notes (2026-02-12)
- Added `docs/COMMUNITY_REPORTING_OPS_POLICY.md` covering category/severity SLA, escalation ladder, emergency response paths, communication templates, abuse handling signals, and retention windows.
- Documented scheduled retention job plan (`communityReportRetentionSweep`) with required summary telemetry fields.
- Linked architecture to policy document in `docs/COMMUNITY_REPORTING_ARCHITECTURE.md`.
