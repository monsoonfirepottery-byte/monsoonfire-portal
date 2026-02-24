# Studio Reservation Operations Playbook

## Purpose
Provide one operational source of truth for reservation lifecycle handling, queue triage, and customer messaging.

## Canonical lifecycle
1. Intake: `REQUESTED`
2. Staff confirmation: `CONFIRMED`
3. Capacity overflow/deferral: `WAITLISTED`
4. Cancellation: `CANCELLED`
5. Load progression (independent): `queued` -> `loading` -> `loaded`

All status/load changes should be made through `PortalApi.updateReservation` so timeline metadata stays consistent.

## Queue triage rules (staff)
1. Use server queue hints (`queuePositionHint`, `estimatedWindow`) as default ordering guidance.
2. Prioritize safety and kiln fit first, then urgency (`rushRequested`, whole-kiln), then fairness penalty, then age.
3. Move to `WAITLISTED` when:
   - capacity is exceeded,
   - required station/resources are unavailable,
   - safety/quality constraints require deferral.
4. Use `staffNotes` on each status change when triage rationale is not obvious.

## Queue fairness controls (staff)
1. Use `apiV1/v1/reservations.queueFairness` for fairness actions:
   - `record_no_show`
   - `record_late_arrival`
   - `set_override_boost`
   - `clear_override`
2. Every fairness action requires a written reason.
3. Policy weighting is deterministic:
   - no-show: `+2` penalty points
   - late arrival: `+1` penalty point
   - active override boost offsets penalty points.
4. Evidence is written to `reservationQueueFairnessAudit` and linked on reservation cards.
5. Do not apply fairness penalties without clear supporting evidence (pickup miss, arrival record, staff note).

## Offline queue fallback (staff kiosk)
1. Staff queue writes are offline-safe in portal reservation tools:
   - status transitions,
   - station assignment,
   - pickup-window staff actions,
   - fairness policy actions.
2. When offline/unreliable:
   - actions are queued locally with `queueRevision`, actor uid, and request payload.
   - UI shows sync state (`pending`, `synced`, `failed`) and queue length.
3. Recovery behavior:
   - queued actions replay automatically when online returns,
   - `failed` actions require manual correction (stale/conflict/permission cases),
   - operators can run `Sync now` and `Clear failed` in the panel.
4. Do not clear failed actions until the reservation card state is verified and corrected manually.

## Cancellation and waitlist policy
1. `CANCELLED` is terminal for normal operations.
2. If a user requests reactivation, create/confirm a new reservation path or use explicit admin override workflow.
3. `WAITLISTED` reservations must include a practical expectation message (target window or TBD with reason).

## ETA shift escalation
Escalate when any of these occur:
1. ETA shifts more than one planning band.
2. Repeat delays for the same reservation.
3. Safety/resource outage impacts multiple active reservations.

Escalation action:
1. Add/update `staffNotes`.
2. Provide updated ETA band with reason.
3. Trigger notification workflow as configured.

## Customer-facing expectation copy
After submission:
1. Confirmation that the request is in queue.
2. Queue context + ETA band (or stable TBD copy).

When delayed:
1. What changed.
2. New expected window.
3. What happens next and when another update will be sent.

When ready for pickup:
1. Ready status and next steps.
2. Pickup timing guidance.
3. Storage-window reminder if applicable.

Storage escalation:
1. Mention hold status and notice history.
2. Share latest action date.
3. Provide recovery/collection path.

## Continuity export and restore
1. Use `apiV1/v1/reservations.exportContinuity` for owner-scoped continuity bundles.
2. Minimum export set:
   - reservations,
   - stageHistory,
   - piece rows,
   - storage notice/actions,
   - storage audit rows,
   - queue fairness audit rows,
   - user notification history.
3. Artifact requirements:
   - JSON bundle and optional CSV bundle,
   - schema version in export header,
   - deterministic signature (`mfexp_*`),
   - redaction notes (no arrival tokens, no raw piece photo URLs).
4. Portal operator path:
   - open Reservations view,
   - use `Export continuity bundle`,
   - attach generated artifact id in incident/work ticket.
5. Restore checklist after outage/incident:
   - verify reservation counts and latest `updatedAt` against exported summary,
   - verify stage-history tail and storage notice history for affected reservations,
   - verify fairness evidence parity in `reservationQueueFairnessAudit`,
   - verify customer notification timeline in `users/{uid}/notifications`.

## QA end-to-end path
Run this path in release validation:
1. Intake (`REQUESTED`) from client flow.
2. Staff confirm (`CONFIRMED`).
3. Delay/deferral (`WAITLISTED`) with reason note.
4. Ready-for-pickup reminder path (`loaded` + customer update).
5. Storage escalation policy handoff path.

Station-level scenario (required in QA evidence):
1. Fill a station to near-capacity.
2. Attempt one additional station assignment.
3. Confirm server returns capacity conflict and UI shows actionable copy.

Expected evidence:
1. `stageHistory` entries for each transition.
2. `stageStatus` reflects latest transition.
3. UI shows queue context + status updated timestamp + note snippet.

## Documentation gate expectation
Any new reservation field or status semantics change must include same-release updates to:
1. `docs/SCHEMA_RESERVATIONS.md`
2. This playbook file
3. Any affected policy doc under `docs/policies/`
