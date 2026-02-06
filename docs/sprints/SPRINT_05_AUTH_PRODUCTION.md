# Sprint 05 - iOS Auth + Production Readiness

Window: Week 5  
Goal: Move iOS shell from token-paste mode to real Firebase Auth production flows.

## Ticket S5-01
- Title: Firebase Auth session integration (provider + sign-out)
- Swarm: `Swarm A`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S1-04, S4-04
- Deliverables:
  - integrate Firebase Auth SDK in iOS shell
  - remove manual token dependency for core flows
  - auth state listener and sign-out action
- Verification:
1. Signed-out and signed-in states transition correctly.
2. ID token refresh is automatic and used by API calls.
3. Manual token field remains available as fallback when FirebaseAuth SDK is unavailable.

## Ticket S5-02
- Title: Email/password + magic-link parity
- Swarm: `Swarm A`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S5-01
- Deliverables:
  - email/password sign-in UI and flow
  - email-link completion handling
- Verification:
1. Both auth paths result in active signed-in session.
2. Errors are user-visible and non-crashing.
3. Pending email fallback is used when completing magic-link flow.

## Ticket S5-03
- Title: Route protection and role-aware gating
- Swarm: `Swarm A`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S5-01
- Deliverables:
  - gate staff-only actions (kiln unload, staff check-in)
  - enforce signed-in requirement for write actions
- Verification:
1. Unauthorized users cannot execute staff actions.
2. Signed-out users are redirected to auth entry.

## Ticket S5-04
- Title: Production auth runbook + migration cleanup
- Swarm: `Swarm A`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S5-01, S5-02, S5-03
- Deliverables:
  - update `docs/IOS_RUNBOOK.md` for auth-first usage
  - deprecate token-paste-only workflow in docs
- Verification:
1. Runbook supports first-time setup without manual token copying.
2. Auth troubleshooting section is complete.

## Ticket S5-05
- Title: Push notification permission + device registration foundation
- Swarm: `Swarm A`
- Owner: TBD
- State: `ready_for_verification`
- Dependencies: S5-01
- Deliverables:
  - local notification permission flow in iOS shell
  - explicit notification authorization status visibility
  - foundation hooks for device token registration follow-up
- Verification:
1. Permission prompt can be triggered from shell.
2. Authorization state updates correctly after permission response.
3. Unsupported builds degrade with clear status messaging.
4. Device token capture hook stores token for follow-up registration flow.
