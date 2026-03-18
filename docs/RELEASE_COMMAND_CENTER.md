# Portal + Website Release Command Center

Last reviewed: 2026-03-18
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

- Smoke Tests: success on 2026-03-18 ([run 23259872136](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872136))
- Lighthouse Audit: success on 2026-03-18 ([run 23259872137](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872137))
- iOS macOS Smoke: success on 2026-03-18 ([run 23259872190](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872190))
- `ios-build-gate`: success on 2026-03-18 ([run 23259872139](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872139))
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

## RC decisions

- Portal baseline auth for this release candidate is Google, Email/Password, Email Link, and Microsoft.
- Facebook and Apple provider expansion are deferred out of the single RC unless business requirements change.
- Website is treated as launched and maintenance-only; only smoke, accessibility, analytics-contract, and policy-parity regressions are in RC scope.
- Studio OS v3, staff-console refinement, community/events/library growth, and Codex improvement churn are frozen outside the RC unless they expose a regression in live launch paths.

## Remaining blockers

- Release evidence still needs explicit operator completion in [docs/RELEASE_CANDIDATE_EVIDENCE.md](RELEASE_CANDIDATE_EVIDENCE.md):
  - notification reliability proof
  - security rotation proof
  - release sign-off fields
- Portal infra/security and QA rolling threads still need final disposition against the refreshed evidence:
  - [#349](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/349)
  - [#350](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/350)

## Open GitHub issue dispositions

| Issue | Disposition | RC status |
| --- | --- | --- |
| [#348](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/348) | Keep open as rolling Codex coordination | not a ship blocker |
| [#349](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/349) | Keep open until infra/security evidence is explicitly signed off | ship review lane |
| [#350](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/350) | Keep open until QA evidence is explicitly signed off | ship review lane |
| [#351](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/351) | Keep open as rolling governance tuning | not a ship blocker |
| [#352](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/352) | Defer until after ship | out of RC scope |
| [#360](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/360) - [#365](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/365) | Close as Codex improvement noise for post-RC handling | remove from RC queue |
| [#366](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/366) | Close as duplicate rolling digest | fold into [#348](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/348) |
| [#367](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/367) | Close as stale after latest green promotion gate/canary | fold into [#350](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/350) if the signature recurs |

## Frozen scope

- [tickets/v3/EPICS.md](../tickets/v3/EPICS.md)
- [tickets/v3/STATUS.md](../tickets/v3/STATUS.md)
- [docs/epics/EPIC-STAFF-PORTAL-MODULE-CONSOLIDATION.md](epics/EPIC-STAFF-PORTAL-MODULE-CONSOLIDATION.md)
- Community, events, lending-library, and other feature-growth epics under [docs/epics](epics)

## RC exit checklist

- No open PRs against `main`
- Release evidence pack reflects current successful runs
- Every open GitHub issue has an explicit RC disposition
- Only ship-review lanes remain open for launch readiness
- Final operator sign-off is recorded in the release evidence pack
