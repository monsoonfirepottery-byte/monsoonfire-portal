# Sprint 02 - Core Studio Flows

Window: Week 2  
Goal: Deliver core member/staff kiln workflows on iOS.

## Ticket S2-01
- Title: Reservations check-in flow parity (form + submit)
- Swarm: `Swarm B`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S1-01, S1-02
- Deliverables:
  - check-in form parity for required fields
  - `createReservation` submit path
  - submission status/error states
- Verification:
1. Successful createReservation returns reservation ID and REQUESTED state.
2. Validation failures surface user-friendly errors.
3. iOS form submit failures are logged via `mf_handler_error_log_v1` and visible in the shell log section.

## Ticket S2-02
- Title: Photo upload parity for reservations
- Swarm: `Swarm B`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S2-01
- Deliverables:
  - Firebase Storage upload with size/format checks
  - photo URL/path passed to createReservation payload
- Verification:
1. Upload success path stores and submits URL/path.
2. Upload failure path does not submit broken payload.
3. File validation rejects unsupported file types and oversized uploads before submit.

## Ticket S2-03
- Title: My Pieces read + key actions parity
- Swarm: `Swarm B`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S2-01
- Deliverables:
  - active/history list parity
  - key action hooks (read-only if actions not yet finalized)
- Verification:
1. Lists load without permission/runtime errors.
2. Core view transitions and detail panel are stable.
3. Missing FirebaseFirestore SDK path fails with a user-visible status instead of a crash.

## Ticket S2-04
- Title: Kiln schedule and unload action parity
- Swarm: `Swarm B`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S2-01
- Deliverables:
  - kiln/firing list display
  - unload action for staff users
- Verification:
1. Staff unload action updates target firing fields.
2. Non-staff cannot trigger unload.
3. Missing FirebaseFirestore SDK path fails with a visible status and no runtime crash.
