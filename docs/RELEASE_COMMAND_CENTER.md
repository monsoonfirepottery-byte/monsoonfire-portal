# Portal + Website Release Command Center

Last reviewed: 2026-03-18 (notification evidence complete; security blocker remains)
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

## Current live evidence

- Smoke Tests: success on 2026-03-18 ([run 23268174209](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23268174209))
- Lighthouse Audit: success on 2026-03-18 ([run 23268174183](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23268174183))
- iOS macOS Smoke: success on 2026-03-18 ([run 23268174197](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23268174197))
- `ios-build-gate`: success on 2026-03-18 ([run 23268174202](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23268174202))
- Android Compile Check: success on 2026-03-17 ([run 23218840965](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23218840965))
- Deploy to Firebase Hosting on merge: success on 2026-03-18 ([run 23259872147](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872147))
- Portal Post-Deploy Promotion Gate: success on 2026-03-18 ([run 23259950672](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259950672))
- Portal Daily Authenticated Canary: success on 2026-03-18 ([run 23257627816](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23257627816))
- Local portal cutover verify refreshed on 2026-03-18:
  - [artifacts/deploy-evidence-latest.md](../artifacts/deploy-evidence-latest.md)
  - [output/qa/post-deploy-cutover-verify.json](../output/qa/post-deploy-cutover-verify.json)
- Local website production smoke refreshed on 2026-03-18:
  - [output/playwright/prod/smoke-summary.json](../output/playwright/prod/smoke-summary.json)
  - Smoke currently passes after aligning the support-topic selector to the live `payments` taxonomy.
  - Local execution required a temporary `STUDIO_BRAIN_INTEGRITY_OVERRIDE` because the smoke runner is coupled to an unrelated Studio Brain integrity guard.
- Notification reliability proof refreshed on 2026-03-18:
  - [output/qa/notification-evidence-2026-03-18T22-45-24-279Z.json](../output/qa/notification-evidence-2026-03-18T22-45-24-279Z.json)
  - [output/qa/notification-partial-parity-local.json](../output/qa/notification-partial-parity-local.json)
  - Production proof now covers retry exhaustion, dead letters, aggregate metrics, and stale-token cleanup after Firestore index remediation.
  - Local parity proof covers `PUSH_PROVIDER_PARTIAL` plus invalid-token deactivation (`BadDeviceToken`) against the real notification code path.

## RC decisions

- Portal baseline auth for this release candidate is Google, Email/Password, Email Link, and Microsoft.
- Facebook and Apple provider expansion are deferred out of the single RC unless business requirements change.
- Website is treated as launched and maintenance-only; only smoke, accessibility, analytics-contract, and policy-parity regressions are in RC scope.
- Studio OS v3, staff-console refinement, community/events/library growth, and Codex improvement churn are frozen outside the RC unless they expose a regression in live launch paths.

## Remaining blockers

- RC exit is hard-gated in [docs/RELEASE_CANDIDATE_EVIDENCE.md](RELEASE_CANDIDATE_EVIDENCE.md):
  - security rotation proof
  - final operator sign-off must remain populated and current
- The only remaining hard-blocking issue is [#349](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/349).
- Current blocker detail:
  - live runtime proof still shows the push relay path failing with `APNS_RELAY_URL not configured`
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
- Only [#349](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/349) remains as a ship blocker
- Final operator sign-off is recorded in the release evidence pack
