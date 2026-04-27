# Portal + Website Release Command Center

Last reviewed: 2026-04-15 (live surface refresh: auth blocker confirmed; website handoff held in phase 1)
Operating mode: single release candidate consolidation

## Current posture

- Control checkout: `main` in `D:/tmp/mf-portal-repo-stabilization`
- Open PRs: none
- Live portal target: `https://portal.monsoonfire.com`
- Live website target: `https://monsoonfire.com`
- Release stance: stabilize and certify the existing portal and website, freeze feature-growth work unless it blocks ship

## Start here

- [docs/README.md](README.md)
- [docs/SOURCE_OF_TRUTH_INDEX.md](SOURCE_OF_TRUTH_INDEX.md)
- [docs/RELEASE_CANDIDATE_EVIDENCE.md](RELEASE_CANDIDATE_EVIDENCE.md)
- [docs/audits/live-surface-audit-2026-04-15.md](audits/live-surface-audit-2026-04-15.md)

## Current live evidence

- Fresh live portal public smoke pass on 2026-04-15:
  - Historical ignored artifact: `output/playwright/portal/prod/portal-smoke-summary.json`
- Fresh live website public smoke pass on 2026-04-15:
  - Historical ignored artifact: `output/playwright/prod/smoke-summary.json`
- Fresh live website phase-1 handoff verification on 2026-04-15:
  - Historical ignored artifact: `output/playwright/prod-phase1-website/smoke-summary.json`
- Fresh live authenticated portal canary pass on 2026-04-15:
  - Historical ignored artifact: `output/qa/portal-authenticated-canary-rc1.json`
- Fresh live Lighthouse sweep on 2026-04-15:
  - Historical ignored artifact: `output/qa/lighthouse-live-2026-04-15T16-38-08Z`
- Consolidated audit:
  - [docs/audits/live-surface-audit-2026-04-15.md](audits/live-surface-audit-2026-04-15.md)

## RC decisions

- Portal baseline auth for this release candidate is Google, Email/Password, Email Link, and Microsoft.
- Facebook and Apple provider expansion are deferred out of the single RC unless business requirements change.
- Website is treated as launched and maintenance-only; only smoke, accessibility, analytics-contract, and policy-parity regressions are in RC scope.
- Studio OS v3, staff-console refinement, community/events/library growth, and Codex improvement churn are frozen outside the RC unless they expose a regression in live launch paths.

## Remaining blockers

- RC exit is hard-gated in [docs/RELEASE_CANDIDATE_EVIDENCE.md](RELEASE_CANDIDATE_EVIDENCE.md):
  - `RC issue 1`: Google login on `https://portal.monsoonfire.com` is not cycling users cleanly back into the live portal session
  - security rotation proof
  - final operator sign-off must remain populated and current
- Current blocker detail:
  - the live Google auth click-through currently redirects via `https://monsoonfire-portal.firebaseapp.com/__/auth/handler`, and the live bundle omits `auth.monsoonfire.com`
  - the portal auth fix is deployed for direct testing on `https://portal.monsoonfire.com`, but a real operator Google round-trip still needs to be verified on the live surface
  - the public website handoff is intentionally held on `https://monsoonfire.kilnfire.com` for phase 1; phase 2 cutover to `https://portal.monsoonfire.com` is deferred until explicit operator approval
  - infra/security evidence still shows the push relay path failing with `APNS_RELAY_URL not configured`
  - APNS relay runtime configuration and rotation evidence remain incomplete

## Open GitHub issue dispositions

| Issue | Owner | Disposition | Close condition | RC status |
| --- | --- | --- |
| [#348](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/348) | `monsoonfirepottery-byte` (automation owner by default) | Keep open as rolling Codex coordination | Close only if automation coordination is intentionally retired or moved out of GitHub issue tracking | not a ship blocker |
| [#349](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/349) | `monsoonfirepottery-byte` (infra/security owner by default) | Keep open until infra/security evidence is explicitly signed off | Close after security rotation proof is complete, the evidence pack is updated, and the final ship decision is recorded | hard blocker |
| [#351](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/351) | `monsoonfirepottery-byte` (governance owner by default) | Keep open as rolling governance tuning | Close only if governance tuning is intentionally moved out of the rolling issue loop | not a ship blocker |
| [#352](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/352) | `monsoonfirepottery-byte` (backlog/product owner by default) | Defer until after ship | Close only when superseded by smaller implementation tickets or a delivered PR | out of RC scope |

## Frozen scope

- [tickets/v3/EPICS.md](../tickets/v3/EPICS.md)
- [tickets/v3/STATUS.md](../tickets/v3/STATUS.md)
- [docs/epics/EPIC-STAFF-PORTAL-MODULE-CONSOLIDATION.md](epics/EPIC-STAFF-PORTAL-MODULE-CONSOLIDATION.md)
- Community, events, lending-library, and other feature-growth epics under [docs/epics](epics)

## RC exit checklist

- No open PRs against `main`
- Latest successful `Smoke Tests` on `main` remains current and is not superseded by a newer failing run
- Release evidence pack reflects current successful runs and current hard blockers only
- Every open GitHub issue has an explicit owner, RC status, and close condition
- Live auth issue log is empty or explicitly accepted by the operator before ship
- Final operator sign-off is recorded in the release evidence pack
