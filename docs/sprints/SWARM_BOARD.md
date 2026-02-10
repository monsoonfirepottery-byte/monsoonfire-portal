# Swarm Board

Date: 2026-02-05  
Use this board for daily execution and ticket routing.

## Active Sprints
- Sprint 01: `docs/sprints/SPRINT_01_FOUNDATIONS.md`
- Sprint 02: `docs/sprints/SPRINT_02_CORE_STUDIO.md`
- Sprint 03: `docs/sprints/SPRINT_03_COMMERCE_EVENTS.md`
- Sprint 04: `docs/sprints/SPRINT_04_HARDENING_ALPHA.md`
- Sprint 05: `docs/sprints/SPRINT_05_AUTH_PRODUCTION.md`
- Sprint 06: `docs/sprints/SPRINT_06_DEVICE_RELEASE.md`
- Sprint 07: `docs/sprints/SPRINT_07_PUSH_OPERATIONS.md`
- Sprint 08: `docs/sprints/SPRINT_08_RELEASE_CONTROLS.md`
- Sprint 09: `docs/sprints/SPRINT_09_STABILIZATION_DRILLS.md`
- Sprint 10: `docs/sprints/SPRINT_10_ALPHA_LAUNCH.md`
- Sprint 11: `docs/sprints/SPRINT_11_PERF_TESTING.md`
- Sprint 12: `docs/sprints/SPRINT_12_MOBILE_TRANSLATION_RISKS.md`

## Swarm Allocation
- `Swarm A` (Auth + Contracts):
  - S1-01, S1-02, S1-03, S1-04
- `Swarm B` (Core Studio):
  - S2-01, S2-02, S2-03, S2-04
- `Swarm C` (Commerce + Events):
  - S3-01, S3-02, S3-03, S3-04
- `Swarm D` (Hardening + QA):
  - S4-01, S4-02, S4-03, S4-04
- `Swarm A` (Auth + Production):
  - S5-01, S5-02, S5-03, S5-04, S5-05
- `Swarm A` (Device + Auth Backend):
  - S6-01, S6-02
- `Swarm B` (Deep Links):
  - S6-04
- `Swarm C` (Notification Routing):
  - S6-03
- `Swarm D` (Release CI):
  - S6-05
- `Swarm A` (Push Lifecycle):
  - S7-01
- `Swarm B` (iOS Push Controls):
  - S7-04
- `Swarm C` (Push Delivery):
  - S7-02, S7-03
- `Swarm D` (Push Runbook):
  - S7-05
- `Swarm A` (Reliability Controls):
  - S8-01, S8-04
- `Swarm C` (Delivery Metrics):
  - S8-02
- `Swarm D` (Release Ops):
  - S8-03, S8-05
- `Swarm A` (Stabilization Drills):
  - S9-01, S9-03
- `Swarm C` (Metrics Closure):
  - S9-02
- `Swarm D` (Evidence Closure):
  - S9-04
- `Swarm A` (Alpha Auth + Security):
  - S10-01, S10-06
- `Swarm B` (Release Branch Hygiene):
  - S10-03
- `Swarm C` (iOS Runtime Validation):
  - S10-05
- `Swarm D` (Alpha Evidence + CI):
  - S10-02, S10-04
- `Swarm D` (Perf + CI):
  - S11-01, S11-04
- `Swarm B` (Web Perf):
  - S11-02
- `Swarm A` (Tests):
  - S11-03
- `Swarm C` (Functions Perf):
  - S11-05

## Active Work
- `Swarm A`: `S1-01` (`ready_for_verification`) - contract mirror parity
- `Swarm A`: `S1-04` (`ready_for_verification`) - iOS shell + env bootstrap
- `Swarm A`: `S1-02` (`ready_for_verification`) - API client metadata parity
- `Swarm A`: `S1-03` (`ready_for_verification`) - iOS handler log ring buffer
- `Swarm B`: `S2-01` (`ready_for_verification`) - iOS reservation check-in form + submit parity
- `Swarm B`: `S2-02` (`ready_for_verification`) - iOS reservation photo upload parity
- `Swarm B`: `S2-03` (`ready_for_verification`) - iOS My Pieces active/history read + detail
- `Swarm B`: `S2-04` (`ready_for_verification`) - iOS kiln schedule read + staff unload action
- `Swarm C`: `S3-01` (`ready_for_verification`) - iOS events list/detail/signup/cancel parity
- `Swarm C`: `S3-02` (`ready_for_verification`) - iOS events staff roster + check-in parity
- `Swarm C`: `S3-03` (`ready_for_verification`) - iOS materials catalog/cart/checkout parity
- `Swarm C`: `S3-04` (`ready_for_verification`) - iOS billing summary parity
- `Swarm D`: `S4-01` (`ready_for_verification`) - iOS performance hardening pass
- `Swarm D`: `S4-02` (`ready_for_verification`) - iOS retry/offline hardening
- `Swarm D`: `S4-03` (`ready_for_verification`) - iOS accessibility baseline pass
- `Swarm D`: `S4-04` (`ready_for_verification`) - alpha gate report prepared
- `Swarm A`: `S5-01` (`ready_for_verification`) - iOS Firebase Auth session integration
- `Swarm A`: `S5-02` (`ready_for_verification`) - iOS email/password + magic-link parity
- `Swarm A`: `S5-03` (`ready_for_verification`) - iOS route protection + role-aware gating
- `Swarm A`: `S5-04` (`ready_for_verification`) - iOS auth-first runbook + migration cleanup
- `Swarm A`: `S5-05` (`ready_for_verification`) - iOS push notification permission + token hook
- `Swarm A`: `S6-01` (`ready_for_verification`) - APNs token backend registration endpoint
- `Swarm A`: `S6-02` (`ready_for_verification`) - iOS token submit wiring + retry
- `Swarm C`: `S6-03` (`ready_for_verification`) - notification routing model (member/staff segments)
- `Swarm B`: `S6-04` (`ready_for_verification`) - iOS deep-link callback handling
- `Swarm D`: `S6-05` (`ready_for_verification`) - macOS CI pipeline for iOS build + smoke checks
- `Swarm A`: `S7-01` (`ready_for_verification`) - device token lifecycle hardening
- `Swarm C`: `S7-02` (`ready_for_verification`) - push attempt telemetry baseline
- `Swarm C`: `S7-03` (`ready_for_verification`) - APNs provider adapter implementation
- `Swarm B`: `S7-04` (`ready_for_verification`) - iOS token lifecycle controls
- `Swarm D`: `S7-05` (`ready_for_verification`) - push operations runbook + contract docs
- `Swarm A`: `S8-01` (`ready_for_verification`) - retry policy + dead-letter pipeline
- `Swarm C`: `S8-02` (`ready_for_verification`) - delivery metrics aggregation
- `Swarm D`: `S8-03` (`ready_for_verification`) - alert thresholds + on-call runbook
- `Swarm A`: `S8-04` (`ready_for_verification`) - relay credential deployment hardening
- `Swarm D`: `S8-05` (`ready_for_verification`) - release candidate evidence pack
- `Swarm A`: `S9-01` (`ready_for_verification`) - push failure-class drill execution
- `Swarm C`: `S9-02` (`ready_for_verification`) - metrics + alert baseline finalization
- `Swarm A`: `S9-03` (`ready_for_verification`) - secret rotation evidence
- `Swarm D`: `S9-04` (`ready_for_verification`) - release evidence pack closure
- `Swarm A`: `S10-01` (`todo`) - run live drill suite with real staff auth
- `Swarm D`: `S10-02` (`todo`) - complete release evidence pack and sign-off
- `Swarm B`: `S10-03` (`todo`) - branch hygiene and release diff freeze
- `Swarm D`: `S10-04` (`todo`) - full CI gate run + remediation
- `Swarm C`: `S10-05` (`todo`) - iOS runtime verification on macOS
- `Swarm A`: `S10-06` (`todo`) - dependency/security audit triage
- `Swarm D`: `S11-01` (`todo`) - web perf budgets and Lighthouse baseline
- `Swarm B`: `S11-02` (`todo`) - bundle/chunk budget enforcement and regressions
- `Swarm A`: `S11-03` (`todo`) - expand automated tests for alpha-critical flows
- `Swarm D`: `S11-04` (`todo`) - lint debt payoff and CI enforcement
- `Swarm C`: `S11-05` (`todo`) - functions performance and cold-start risk review

## Daily Verification Pass
Run on all active branches/tickets:
1. `npm --prefix web run lint`
2. `npm --prefix web run test:run`
3. `npm --prefix web run build`
4. `npm --prefix web run perf:chunks`

## Blocker Escalation Rules
- If a ticket is blocked > 24h:
  - mark `blocked`
  - add dependency + unblock owner
  - Sprint Manager reassigns or splits ticket
- If contract ambiguity exists:
  - update `docs/API_CONTRACTS.md` first
  - pause dependent implementation tickets until aligned
