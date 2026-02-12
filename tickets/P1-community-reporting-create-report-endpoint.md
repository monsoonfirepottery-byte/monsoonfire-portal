# P1 — Community Reporting `createReport()` Endpoint

Status: Planned

## Context / user story
- As a signed-in user, when I report a card, backend must validate and persist report/audit records.

## Acceptance criteria
1. New authenticated function endpoint `createReport()` implemented.
2. Input validation enforced:
   - `targetType`, `targetRef`, `category`, `severity`, note length.
3. Rate limits enforced:
   - per uid/day (default 5/day)
4. Dedupe enforced:
   - same reporter + same target within 24h is rejected (or returns existing receipt)
5. Report write succeeds to `reports/{id}` with immutable reporter attribution and `targetSnapshot`.
6. Matching audit write succeeds to `reportAuditLogs/{id}` with `action=create_report`.

## Implementation notes
- Canonical enforcement in function (not rules) for rate limit + dedupe + snapshot capture.
- Snapshot captures title/url/source/publishedAt at report time for triage consistency.
- Use deterministic dedupe key (e.g., hash of reporterUid+targetType+targetId+window bucket).

## Security considerations
- Require Firebase Auth (`request.auth.uid`) and reject anonymous/unsigned.
- Reject unknown categories/severities.
- Strip/ignore any staff-only fields in payload.

## Telemetry / audit logs
- Structured log per request with `requestId`, `uid`, `targetType`, `targetId`, outcome.
- Audit log required for both success and moderated-reject outcomes.

## Dependencies
- `tickets/P1-community-reporting-foundation.md`

## Estimate
- M
