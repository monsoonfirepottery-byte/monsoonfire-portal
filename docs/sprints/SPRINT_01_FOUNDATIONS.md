# Sprint 01 - Foundations

Window: Week 1  
Goal: iOS project foundations + contract parity + observability parity.

## Ticket S1-01
- Title: Lock contract mirror parity (`portalContracts.ts` -> `ios/PortalContracts.swift`)
- Swarm: `Swarm A`
- Owner: `Swarm A / Codex`
- State: `ready_for_verification`
- Dependencies: none
- Deliverables:
  - Swift contract types match all current web contracts.
  - `docs/API_CONTRACTS.md` updated if needed.
- Verification:
1. Static compare of contract entities between files.
2. Spot-check createReservation, events, materials, billing response types.
3. Verify importLibraryIsbns request/response mirrors are present in Swift.

## Ticket S1-02
- Title: Harden `PortalApiClient.swift` request metadata parity
- Swarm: `Swarm A`
- Owner: `Swarm A / iOS API Lead`
- State: `ready_for_verification`
- Dependencies: S1-01
- Deliverables:
  - Auth bearer handling
  - optional admin token header
  - request/response metadata capture
  - curl-equivalent debug output
- Verification:
1. Simulated request path captures request + response metadata.
2. Error envelope mapping mirrors web behavior.

## Ticket S1-03
- Title: Implement iOS handler/network error logging ring buffer
- Swarm: `Swarm A`
- Owner: `Swarm A / iOS Platform Lead`
- State: `ready_for_verification`
- Dependencies: S1-02
- Deliverables:
  - iOS local log store mirroring `mf_handler_error_log_v1` semantics.
  - log read/clear utility API.
- Verification:
1. Inject failure path and verify log write.
2. Verify clear operation empties log.

## Ticket S1-04
- Title: Bootstrap iOS app shell and env configuration
- Swarm: `Swarm A`
- Owner: `Swarm A / iOS App Lead`
- State: `ready_for_verification`
- Dependencies: none
- Deliverables:
  - App shell scaffold with environment toggle support.
  - base navigation container.
- Verification:
1. App launches with dev/prod config.
2. Basic route container renders without runtime errors.
3. Follow `docs/IOS_RUNBOOK.md` smoke test steps.
