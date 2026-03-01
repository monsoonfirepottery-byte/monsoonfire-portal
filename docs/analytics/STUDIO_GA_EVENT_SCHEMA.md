# Studio GA Event Schema (Lifecycle)

Version: 2026-02-28  
Owner: Website + Analytics Team  
Scope: `web/src/views/ReservationsView.tsx`, `web/src/views/KilnLaunchView.tsx`

## Canonical events

| event_name | when it fires | required params |
|---|---|---|
| `reservation_created` | Reservation create call succeeds | `uid,surface,reservationId,actorRole,mode,firingType,kilnId,intakeMode` |
| `reservation_station_assigned` | Staff station assignment succeeds | `uid,surface,reservationId,actorRole,stationId` |
| `kiln_load_started` | Staff moves load state to `loading` | `uid,surface,reservationId,actorRole,transitionFrom,transitionTo` |
| `status_transition` | Reservation lifecycle mutation succeeds, queues offline, retries, or rolls back | `uid,surface,reservationId,actorRole,transitionDomain,transitionAction,transitionOutcome` |
| `pickup_ready` | Pickup is ready (staff opens pickup window or load reaches `loaded`) | `uid,surface,reservationId,actorRole` |
| `pickup_completed` | Staff marks pickup completed | `uid,surface,reservationId,actorRole` |
| `status_transition_exception` | Lifecycle mutation fails | `uid,surface,reservationId,actorRole,transitionDomain,transitionAction,errorCode,errorMessage` |

## Transition domains

- `reservation_create`
- `reservation_status`
- `station_assignment`
- `pickup_window`
- `kiln_load`

## Transition outcomes

- `success`
- `queued_offline`
- `queued_retry`
- `rollback`

## Source mapping

- `ReservationsView.handleSubmit` -> `reservation_created`, `status_transition_exception`
- `ReservationsView.assignStationForReservation` -> `reservation_station_assigned`, `status_transition`, `status_transition_exception`
- `ReservationsView.applyStatusAction` -> `status_transition`, `status_transition_exception`
- `ReservationsView.undoLastStatusAction` -> `status_transition` (`transitionOutcome=rollback`), `status_transition_exception`
- `ReservationsView.runPickupWindowAction` -> `status_transition`, `pickup_ready`, `pickup_completed`, `status_transition_exception`
- `KilnLaunchView.handleLoadStatusUpdate` -> `status_transition`, `kiln_load_started`, `pickup_ready`, `status_transition_exception`

## Funnel definition

Primary funnel for monthly review:
1. `reservation_created`
2. `reservation_station_assigned`
3. `kiln_load_started`
4. `pickup_ready`
5. `pickup_completed`

## Notes

- `reservationId` is always shortened (`shortId`) before analytics emission.
- `errorMessage` is truncated to reduce PII risk in telemetry payloads.
- Queue/retry outcomes are emitted as `status_transition` with explicit `transitionOutcome`.
