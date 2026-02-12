# P1 — Reporting Rules, Validation, and Security Test Pack

Status: Planned

## Context / user story
- As platform/security owners, we need hard guarantees that users cannot tamper with report workflow fields and cannot abuse endpoints.

## Acceptance criteria
1. Firestore rules enforce:
   - user can create only own report (`reporterUid == request.auth.uid`)
   - user cannot write staff-only fields (`status`, `assignee`, `internalNotes`, `actions`)
   - user cannot read other users' reports
   - staff can read/write triage fields
2. Unit tests cover:
   - category/severity validation
   - dedupe and rate-limit logic
3. Integration tests cover:
   - `createReport` writes report + audit log
   - staff status/action writes audit log
4. Rules tests prove cross-user read/write denial.

## Implementation notes
- Keep rule tests in emulator suite.
- Keep function tests deterministic with fixed clock for dedupe window assertions.

## Security considerations
- Prevent scope bypass via direct Firestore writes.
- Validate note length and sanitize output rendering path.

## Telemetry / audit logs
- Ensure logs exist for rejected requests with reason codes (`rate_limited`, `duplicate_report`, `invalid_target`).

## Dependencies
- `tickets/P1-community-reporting-create-report-endpoint.md`

## Estimate
- M
