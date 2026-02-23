# Sprint 10/11 Gap Mapping and Sequencing

Date: 2026-02-23  
Owner: PM + Engineering  
Parent Ticket: `tickets/P2-sprint-10-11-gap-cleanup-tickets.md`

## Purpose

Normalize Sprint 10 and Sprint 11 plan entries to canonical `tickets/*.md` records so open priorities, ownership, and dependency order are explicit.

## Sprint 10 Mapping

| Sprint Item | Canonical Ticket | Status | Priority | Notes |
|---|---|---|---|---|
| `S10-01` live notification drill suite with real staff auth | `tickets/P0-alpha-drills-real-auth.md` | `Blocked` | `P0` | Remaining open Sprint 10 priority; blocked on real production staff token + execution window. |
| `S10-02` release evidence pack + sign-off | `tickets/P0-alpha-release-evidence-pack.md` | `Completed` | `P0` | Evidence capture and sign-off checklist populated. |
| `S10-03` branch hygiene and release diff freeze | `tickets/P1-release-branch-hygiene.md` | `Completed` | `P1` | Release slicing and diff-summary work completed. |
| `S10-04` full CI gate run + remediation | `tickets/P1-ci-gates-remediation.md` | `Completed` | `P1` | Lint/smoke/perf gate remediation completed with ticket evidence. |
| `S10-05` iOS runtime verification on macOS | `tickets/P1-ios-runtime-macos-verification.md` | `Completed` | `P1` | iOS macOS smoke/build validation completed in tracked ticket. |
| `S10-06` dependency/security audit triage | `tickets/P0-security-advisories-dependency-remediation-2026-02-19.md` | `Completed` | `P0` | High-severity remediation completed. |
| `S10-06` supporting dependency hygiene record | `tickets/P1-dependency-audit-triage.md` | `Completed` | `P1` | Companion audit/triage evidence and follow-through. |

## Sprint 11 Mapping

| Sprint Item | Canonical Ticket | Status | Priority | Notes |
|---|---|---|---|---|
| `S11-01` Lighthouse baseline and budgets | `tickets/P2-s11-01-lighthouse-budgets-and-baseline.md` | `Completed` | `P2` | Lighthouse baseline + budget evidence tracked. |
| `S11-02` route bundle/chunk budgets | `tickets/P2-s11-02-route-bundle-chunk-budgets.md` | `Completed` | `P2` | Route/chunk budget guardrails and remediation runbook complete. |
| `S11-03` alpha-critical flow test expansion | `tickets/P2-s11-03-critical-flow-test-expansion.md` | `Completed` | `P2` | Deterministic critical-flow coverage expanded. |
| `S11-04` lint debt remediation + CI enforcement | `tickets/P2-s11-04-lint-debt-remediation-and-ci-enforcement.md` | `Completed` | `P2` | Lint enforcement and remediation pass completed. |
| `S11-05` functions cold-start profiling | `tickets/P2-s11-05-functions-cold-start-performance-profiling.md` | `Completed` | `P2` | Profiling artifact + optimization candidate completed. |

## Sequencing Notes (Dependency Ordering)

1. Execute `S10-01` first when external blocker clears because it is the only open Sprint 10/11 priority and a `P0`.
2. After `S10-01`, run the release evidence refresh path only if drift is introduced:
   - `tickets/P0-alpha-release-evidence-pack.md`
   - `tickets/P1-ci-gates-remediation.md`
3. Keep Sprint 11 tickets closed unless regression evidence appears; reopen only the directly affected `S11-*` ticket.
4. Monthly hygiene cadence:
   - `node ./scripts/epic-hub.mjs status`
   - `node ./scripts/backlog-hygiene-audit.mjs --markdown --out docs/sprints/EPIC_06_BACKLOG_AUDIT_YYYY-MM-DD.md`

## Orphan Check

- Open Sprint 10/11 priorities without canonical ticket mapping: `0`
- Blocked Sprint 10/11 priorities currently tracked: `1` (`S10-01`)
