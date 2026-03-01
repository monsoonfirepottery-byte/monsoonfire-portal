# Studio GA Monthly Review

- generatedAtUtc: 2026-02-28T21:02:29.153Z
- eventsCsvPath: /home/wuff/monsoonfire-portal/artifacts/ga/baseline/2026-02-28/event-audit.csv
- status: partial

## Funnel

- 1. Reservation created (reservation_created): 0 | step conversion 100% | from create 0%
- 2. Station assigned (reservation_station_assigned): 0 | step conversion 0% | from create 0%
- 3. Kiln load started (kiln_load_started): 0 | step conversion 0% | from create 0%
- 4. Pickup ready (pickup_ready): 0 | step conversion 0% | from create 0%
- 5. Pickup completed (pickup_completed): 0 | step conversion 0% | from create 0%

## Coverage

- requiredEventsSeen: 0
- requiredEventsMissing: 6
- missing: reservation_created, reservation_station_assigned, kiln_load_started, status_transition, pickup_ready, pickup_completed

## Exceptions + Rollbacks

- statusTransitionExceptionCount: 0
- rollbackCount: 0
- topExceptionReasons: none

## Cadence

- Owner: Website + Analytics Team
- Rhythm: monthly
- Inputs: GA event export CSV for the prior full month
- Follow-up: route remediation tickets for any funnel step conversion < 70%.

