# Sprint 10 - Alpha Launch Readiness

Window: Next quota refresh  
Goal: Close alpha go/no-go evidence, run production drills with real auth, and prepare a clean release branch.

## Ticket S10-01
- Title: Run live notification drill suite with real staff auth
- Swarm: `Swarm A`
- Owner: TBD
- State: `todo`
- Dependencies: S9-01, S9-02
- Deliverables:
- run `node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1` with real staff ID token + UID
  - capture responses in `docs/DRILL_EXECUTION_LOG.md`
  - verify retry/dead-letter behavior in Firestore collections
- Verification:
1. All drill modes execute without `UNAUTHENTICATED`.
2. Expected failure-class behavior is confirmed in data.
3. Metrics aggregation endpoint returns populated counts.

## Ticket S10-02
- Title: Complete release evidence pack and sign-off fields
- Swarm: `Swarm D`
- Owner: TBD
- State: `todo`
- Dependencies: S10-01
- Deliverables:
  - update `docs/RELEASE_CANDIDATE_EVIDENCE.md` from drill outputs and CI runs
  - update `statusCounts/reasonCounts/providerCounts` with real values
  - fill risk register + initial sign-off placeholders
- Verification:
1. No unresolved checklist items remain for alpha gate except explicit accepted risks.
2. Evidence entries map to actual command outputs/URLs.
3. Risk register has owner + mitigation for each open risk.

## Ticket S10-03
- Title: Branch hygiene and release diff freeze
- Swarm: `Swarm B`
- Owner: TBD
- State: `todo`
- Dependencies: None
- Deliverables:
  - split current large worktree into reviewable commit groups
  - remove stale/unintended files from release scope
  - produce final release candidate diff summary
- Verification:
1. No accidental assets/scripts/docs are included in release branch.
2. Each commit is scoped and reviewable.
3. Final diff summary maps changes to sprint tickets.

## Ticket S10-04
- Title: Full CI gate run + remediation pass
- Swarm: `Swarm D`
- Owner: TBD
- State: `todo`
- Dependencies: S10-03
- Deliverables:
  - run/verify `Smoke Tests`, `Lighthouse Audit`, and `iOS macOS Smoke`
  - remediate failing checks or record approved waivers
  - attach CI evidence links
- Verification:
1. All required checks pass or have explicit waiver rationale.
2. CI evidence links are recorded in release docs.
3. No flaky failures remain unresolved.

## Ticket S10-05
- Title: iOS runtime verification on macOS device/simulator
- Swarm: `Swarm C`
- Owner: TBD
- State: `todo`
- Dependencies: S10-03
- Deliverables:
  - run iOS shell flows on macOS/Xcode (auth, token copy, deep links, push controls)
  - capture runtime screenshots/log notes
  - update `docs/IOS_RUNBOOK.md` with observed results/issues
- Verification:
1. Critical flows run without crash on real Xcode runtime.
2. Any runtime issues are ticketed with severity and repro steps.
3. Runbook reflects actual runtime behavior.

## Ticket S10-06
- Title: Dependency/security audit triage
- Swarm: `Swarm A`
- Owner: TBD
- State: `todo`
- Dependencies: S10-03
- Deliverables:
  - audit root/functions/web dependency vulnerabilities
  - patch high/critical issues that are safe pre-alpha
  - document deferred items with owner + timeline
- Verification:
1. High/critical vulnerabilities are either fixed or explicitly accepted with mitigation.
2. Changes do not regress build/test pipelines.
3. Audit notes are stored in release evidence/risk register.
