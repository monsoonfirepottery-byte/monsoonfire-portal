# Library Rollout and Cutover Runbook

Status: Drafted
Date: 2026-03-01
Owner: Library Ops + Platform + Member Experience
Related Ticket: `tickets/P2-library-release-plan-phased-rollout-and-cutover.md`

## Runtime Controls

1. Use `Staff -> Lending -> Library rollout phase`.
2. Select one phase and save:
   - `phase_1_read_only`
   - `phase_2_member_writes`
   - `phase_3_admin_full`
3. Confirm updated metadata:
   - `updatedAtMs`
   - `updatedByUid`
   - rollout note
4. Capture phase metrics artifact from the same panel:
   - click `Refresh phase metrics`
   - click `Copy phase metrics JSON`
   - attach to release evidence record

## Authenticated Smoke Checklist

Test identities:
1. Member account (`member-smoke`)
2. Staff account (`staff-smoke`)
3. Admin account (`admin-smoke`)

### Phase 1 (Authenticated Discovery Read)

1. Member can load library catalog and detail.
2. Member write actions are visibly paused/disabled with trust-based messaging.
3. Staff can open staff lending panel and read rollout + metrics state.
4. Confirm no unauthenticated library route access.
5. Metrics gate:
   - error rate `< 1.0%`
   - route errors (`404`) = `0` for critical routes

### Phase 2 (Member Writes Enabled)

1. Member can complete borrow -> check-in lifecycle.
2. Member can submit rating/review/tag suggestion/reading status.
3. Conflict paths show non-breaking UX (invalid transitions and duplicate actions).
4. Admin-only actions remain hidden/blocked in member mode.
5. Metrics gate:
   - borrow/check-in write failure `< 2.0%`
   - no sustained route errors for critical write endpoints

### Phase 3 (Admin Full Cutover)

1. Staff/admin can create/edit/delete library item.
2. Staff/admin can run ISBN resolve and manual overrides.
3. Staff/admin can moderate recommendations + tags.
4. Staff/admin can run lost-item and replacement-fee workflow.
5. Metrics gate:
   - admin critical routes successful in smoke run
   - metrics artifact captured and attached

## Rollback Procedure (Target < 15 Minutes)

1. Trigger condition confirmed by release owner:
   - gate breach, repeated runtime errors, or blocking admin failure.
2. Set phase immediately:
   - from Phase 3 -> `phase_2_member_writes`
   - from Phase 2 -> `phase_1_read_only`
3. Save rollout note with timestamp, incident id, and operator uid.
4. Refresh phase metrics snapshot and capture JSON artifact.
5. Verify safe-state:
   - member writes paused when in phase 1
   - catalog read path still available for authenticated users
   - admin panel still accessible to staff for recovery
6. Announce rollback in staff comms (template below).
7. Record rollback start/end timestamps and total duration.

## Cutover Communications

### Staff Template

Subject: `Library rollout phase update: {phase_label}`

Body:
1. We moved library rollout to `{phase_label}` at `{timestamp}`.
2. Expected behavior change:
   - `{brief behavior delta}`
3. If you see errors, capture request id from staff troubleshooting and post in `#ops-library`.
4. Next gate review at `{next_check_time}`.

### Member Template

Subject: `Library experience update`

Body:
1. We are rolling out improvements to the studio library in stages.
2. Current state: `{member-facing behavior summary}`.
3. If an action is temporarily paused, your reading and browsing access remains available.
4. Thank you for your feedback while we tune reliability.

## Evidence Bundle Checklist

1. Active rollout phase metadata (phase, updatedByUid, updatedAtMs, note).
2. Phase metrics JSON artifact from staff panel.
3. Smoke log (account used, action, result, timestamp).
4. Any failure request ids with support codes.
5. Rollback drill timing record (if executed in this cycle).

## Rehearsal Log Template

```
Date:
Release owner:
Start time:
End time:
Duration minutes:

Phase promoted:
Phase rolled back (if any):
Reason:

Smoke results:
- member-smoke:
- staff-smoke:
- admin-smoke:

Artifacts attached:
- rollout metadata:
- phase metrics JSON:
- request ids:
```
