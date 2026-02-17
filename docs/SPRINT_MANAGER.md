# Sprint Manager Playbook (Portal + iOS Migration)

Date: 2026-02-05  
Status: Active

## Objective
- Run parallel delivery for web hardening and iOS migration with clear ownership, ticket swarming, and strict verification gates.

## Cadence
- Sprint length: 1 week.
- Daily: 15 min standup + 10 min verification review.
- Mid-sprint: risk check + scope rebalance.
- End-sprint: demo + alpha gate review.

## Roles
- Sprint Manager:
  - owns board state and blockers
  - enforces verification gates
  - resolves dependency ordering
- Feature Lead (per swarm):
  - owns ticket implementation and PR quality
  - drives contract updates if backend changes
- Verifier:
  - runs checklist and signs off ticket verification
  - cannot be ticket implementer for that ticket

## Swarm Model
- `Swarm A` Auth + Shell + Contracts
- `Swarm B` Reservations + Pieces + Kiln
- `Swarm C` Events + Materials + Billing
- `Swarm D` QA/Perf/Release hardening

## Ticket States
- `todo`
- `in_progress`
- `blocked`
- `ready_for_verification`
- `done`

## Definition of Ready
- Ticket has:
  - clear outcome
  - files/surfaces listed
  - dependency list
  - verification checklist

## Definition of Done
- Code merged or ready to merge.
- Verification checklist fully passed.
- Docs updated if contracts/flows changed.
- No lint/test/build regressions.

## Global Verification Gate (all tickets)
1. `npm --prefix web run lint`
2. `npm --prefix web run test:run`
3. `npm --prefix web run build`
4. `npm --prefix web run perf:chunks`

## Alpha Exit Gate
- All Sprint 1-4 tickets complete or accepted with explicit defer notes.
- `checksVoidReturn` and strict lint remain green.
- Handler error log panel operational for QA triage.
- iOS Phase 0 and Phase 1 complete; Phase 2 started with verified contracts.
