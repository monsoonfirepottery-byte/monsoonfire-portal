# Sprint 04 - Hardening + Alpha Exit

Window: Week 4  
Goal: Stabilize iOS and close alpha verification gates.

## Ticket S4-01
- Title: Performance pass on critical iOS screens
- Swarm: `Swarm D`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S2-01, S3-01, S3-03
- Deliverables:
  - startup and primary list screen profiling
  - obvious render/network bottleneck fixes
- Verification:
1. Cold start and hot navigation metrics recorded.
2. No regressions after optimization pass.

## Ticket S4-02
- Title: Retry/offline behavior on critical actions
- Swarm: `Swarm D`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S2-01, S3-03
- Deliverables:
  - graceful offline states
  - safe retry for submit/checkout actions
- Verification:
1. Simulated offline mode surfaces clear UI states.
2. Retry logic avoids duplicate submission behavior.

## Ticket S4-03
- Title: Accessibility pass (VoiceOver + dynamic type)
- Swarm: `Swarm D`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S2-01, S3-01
- Deliverables:
  - semantic labels and focus order on core screens
  - dynamic type sanity pass
- Verification:
1. VoiceOver walk through core flows.
2. Dynamic type at large sizes remains usable.

## Ticket S4-04
- Title: Alpha gate verification run
- Swarm: `Swarm D`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S4-01, S4-02, S4-03
- Deliverables:
  - alpha checklist execution report
  - known issues list with severity labels
- Verification:
1. All alpha gates from `docs/SPRINT_MANAGER.md` reviewed.
2. Sign-off from Sprint Manager + Verifier.
