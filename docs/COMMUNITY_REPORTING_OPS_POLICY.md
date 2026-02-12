# Community Reporting Ops Policy and Retention

## Purpose
This policy defines triage SLAs, escalation paths, abuse handling, and retention for Community reporting data.

## Scope
Applies to:
- `communityReports`
- `communityReports/*/internalNotes`
- `communityReports/*/actions`
- `communityReportAuditLogs`
- `communityReportAppeals`
- `communityFeedOverrides`
- `communityReportDedupe`
- `communityReportTargetSignals`
- `communityReportHousekeeping`

## Severity and SLA
- `high`:
  - Triage start: within 1 hour during staffed hours
  - Containment decision: within 4 hours
  - Escalate to owner/on-call immediately for physical safety, harassment/hate, or legal claims
- `medium`:
  - Triage start: within 1 business day
  - Resolution target: within 3 business days
- `low`:
  - Triage start: within 3 business days
  - Resolution target: within 7 business days

## Escalation Ladder
1. `warn` (document rule + reason code)
2. `hide` (content hidden from feed)
3. `suspend` (target capability suspended pending review)
4. `ban` (irreversible only after human review and owner sign-off)

All irreversible actions require:
- linked policy rule
- explicit reason code
- staff actor UID
- timestamp and before/after snapshot

## Emergency Response Paths
### Emergency content disable
- Use staff action `disable_feed_item` or `unpublish_content`.
- Record incident ID in `internalNotes`.
- Emit audit action: `emergency_disable`.

### User safety escalation
- Mark report as `escalated`.
- Route to studio owner and duty staff.
- If physical-space risk exists, open facility incident record in staff incident log.

## Reporter Communication Templates
- Acknowledgement:
  - "Thanks for the report. We logged it and our staff will review it according to severity."
- Action taken:
  - "We reviewed your report and took action under our Community policy."
- No action:
  - "We reviewed your report and did not take action at this time. We logged your feedback for trend monitoring."

## Abuse and Coordinated Reporting
Signals reviewed in triage:
- duplicate reports from same reporter+target window
- unusual burst rates by account/IP/org
- repeated bad-faith categories over time

If abuse suspected:
- set report status `needs_review`
- require second staff reviewer before punitive action
- add note with `abuse_signal_detected`

## Data Retention Policy
Default retention windows:
- `communityReports`: 24 months
- `internalNotes` and `actions`: 24 months
- `communityReportAuditLogs`: 36 months
- `communityReportAppeals`: 24 months
- `communityFeedOverrides`: until revoked + 12 months archive
- `communityReportDedupe`: 7 days TTL
- `communityReportTargetSignals`: 90 days TTL
- `communityReportHousekeeping`: 12 months

## Scheduled Retention Job Plan
- Job name: `communityReportRetentionSweep`
- Cadence: daily
- Service principal only; no client access
- Steps:
  1. Query expired docs by collection policy
  2. Archive where required
  3. Delete per policy
  4. Write summary record to `communityReportHousekeeping/{jobId}`
  5. Emit structured log counters per collection

Required log fields:
- `jobId`
- `startedAt`, `endedAt`
- `collection`
- `archivedCount`, `deletedCount`, `errorCount`
- `actor` (`system`)

## Security Baseline
- Least privilege IAM for retention job.
- Append-only audit logs for moderation actions.
- Never render reporter notes as HTML.
- No secrets in report documents.

## Review Cadence
- Monthly: SLA adherence and consistency metrics.
- Quarterly: retention policy and legal compliance review.
