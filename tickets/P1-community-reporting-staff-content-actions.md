# P1 — Staff Content Actions for Reported Community Items

Status: In Progress

## Context / user story
- As staff, I need targeted actions based on content type:
  - Internal content can be unpublished/flagged for review.
  - External YouTube links can be disabled from feed.

## Acceptance criteria
1. `takeContentAction` endpoint supports:
   - internal: `unpublish`, `flag_for_review`, `replace_link`
   - external youtube: `disable_from_feed`, `replace_link`
2. Actions validate target type compatibility.
3. Action result updates content visibility source of truth and links report to action record.
4. Every action creates audit log entry with before/after summary.
5. UI shows action outcomes in report history.

## Implementation notes
- Keep action executor modular so future target types can plug in.
- Prefer soft-disable/unpublish over destructive deletes.

## Security considerations
- Staff-only action endpoint.
- Validate that target exists and is eligible for requested action.

## Telemetry / audit logs
- `action=unpublish_content|disable_feed_item|replace_link|flag_for_review`
- Include actor uid, targetType/id, reportId, and outcome.

## Dependencies
- `tickets/P1-community-reporting-staff-triage-dashboard.md`
- `tickets/P1-community-reporting-create-report-endpoint.md`

## Estimate
- M

## Progress notes
- Staff report detail now supports policy-linked content actions with reason codes and action notes.
- Action options are target-aware in UI (`disable_from_feed` for YouTube, `unpublish` for internal items).
- Action execution is wired through `takeContentAction` and reflected in triage outcomes.
