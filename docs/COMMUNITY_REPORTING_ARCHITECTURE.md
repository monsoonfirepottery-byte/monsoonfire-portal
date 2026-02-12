# Community Reporting Architecture

This document describes the Community reporting system used by Monsoon Fire Portal.

## Target types
- `youtube_video`
- `blog_post`
- `studio_update`
- `event`

All reports include:
- `targetRef` (stable target identifiers)
- `targetSnapshot` (title/url/source/author/publishedAt captured at report time)

## Functions contracts
- `createReport` (user auth required)
  - validates category/severity/note/target payload
  - enforces rate limit and dedupe
  - writes report + audit records
- `listMyReports` (user auth)
  - returns reporter-owned reports
- `listReports` (staff auth)
  - returns triage queue with filter support
- `updateReportStatus` (staff auth)
  - status transitions with policy/rule/reason linkage
- `addInternalNote` (staff auth)
  - append-only internal notes
- `takeContentAction` (staff auth)
  - content-specific actions (disable/unpublish/replace/flag)
  - includes before/after summaries in action + audit metadata

## Firestore data model
- `communityReports/{reportId}`
  - reporter identity, status, category, severity, target refs/snapshot, timestamps
- `communityReports/{reportId}/internalNotes/{noteId}`
- `communityReports/{reportId}/actions/{actionId}`
- `communityReportAuditLogs/{auditId}`
- `communityReportAppeals/{appealId}`
- `communityFeedOverrides/{overrideId}`
- `communityReportDedupe/{dedupeKey}`
- `communityReportTargetSignals/{signalKey}`
- `communityReportHousekeeping/{jobId}`

## Rules approach
- Client reads:
  - staff can read all moderation data
  - reporter can read only their own reports/appeals
- Client writes:
  - denied for reports/audit/actions/notes paths
  - canonical writes occur through Cloud Functions only
- Staff-only read paths:
  - audit collections and operational signal collections

## Abuse controls
- Per-user/day report rate limit
- Reporter+target dedupe window (24h)
- Coordination signal tracking by target
- Security audit logging for auth denials/usage

## Audit requirements
- Every user report creates `create_report` audit event
- Every staff mutation creates moderation audit event
- Content actions include before/after state summary
- PAT lifecycle (create/use/revoke/fail) tracked in `integrationTokenAudit`

## Operational notes
- All notes/messages are rendered as plain text in UI.
- No Stripe/secret keys are stored in report documents.
- Existing troubleshooting panels can show latest request/error traces for staff.
- Operational policy + retention details: `docs/COMMUNITY_REPORTING_OPS_POLICY.md`.
