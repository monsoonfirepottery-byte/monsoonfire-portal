# Release Candidate Evidence Pack

## Current RC Refresh (2026-03-18)
- Canonical launch-readiness entrypoint is [docs/RELEASE_COMMAND_CENTER.md](RELEASE_COMMAND_CENTER.md).
- Portal and website are both live, and `main` currently has no open PRs.
- Current RC auth baseline is Google, Email/Password, Email Link, and Microsoft.
- Facebook and Apple provider expansion are explicitly deferred from this RC unless business requirements change.
- Feature-growth work outside deploy/cutover, auth readiness, smoke/promotion gates, accessibility guardrails, and analytics/policy parity is frozen out of this RC.

## Current blockers (2026-03-18)
- Notification reliability evidence is still incomplete.
- Security rotation proof is still incomplete.
- Release sign-off fields below are still blank.

## Build + CI Evidence
- [x] `Smoke Tests` workflow pass ([run 23259872136](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872136))
- [x] `Lighthouse Audit` workflow pass ([run 23259872137](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872137))
- [x] Local LHCI reproducibility pass (2026-02-22, sandbox-safe chrome flags)
  - portal: `npx @lhci/cli@0.15.1 collect --config=web/lighthouserc.json --settings.chromeFlags="--no-sandbox --disable-dev-shm-usage"` + assert
  - website: `npx @lhci/cli@0.15.1 collect --config=website/lighthouserc.json --settings.chromeFlags="--no-sandbox --disable-dev-shm-usage"` + assert
- [x] `iOS macOS Smoke` workflow pass ([run 23259872190](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872190))
- [x] `ios-build-gate` workflow pass ([run 23259872139](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872139))
- [x] `Android Compile Check` workflow pass ([run 23218840965](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23218840965))
- [x] `Deploy to Firebase Hosting on merge` workflow pass ([run 23259872147](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259872147))
- [x] `Portal Post-Deploy Promotion Gate` workflow pass ([run 23259950672](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23259950672))
- [x] `Portal Daily Authenticated Canary` workflow pass ([run 23257627816](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23257627816))
- [x] Local portal cutover verify refreshed on 2026-03-18 -> `output/qa/post-deploy-cutover-verify.json`
- [x] Local website production smoke refreshed on 2026-03-18 -> `output/playwright/prod/smoke-summary.json`
- [x] Functions TypeScript build pass (`npm --prefix functions run build`)
- [x] Functions lint pass (`npm --prefix functions run lint`) (warnings only)
- [x] Web lint pass (`npm --prefix web run lint`)
- [x] Web tests pass (`npm --prefix web run test:run`)
- [x] Web build pass (`npm --prefix web run build`)
- [x] Web chunk budgets pass (`npm --prefix web run perf:chunks`)
- [x] Functions cold-start profile snapshot captured (`npm run functions:profile:coldstart -- --runs 9`) -> `output/functions-coldstart-profile/latest.json`
- [x] Alpha preflight script run (`node ./scripts/ps1-run.mjs scripts/alpha-preflight.ps1`) on head `62eba15dc593cb1c1422183e4d314238859dca51`

## Current notes (2026-03-18)
- The live portal cutover verifier now confirms `/.well-known/apple-app-site-association` returns `200` from `https://portal.monsoonfire.com`.
- The website production smoke needed a smoke-runner selector refresh from `pricing` to `payments` to match the current support taxonomy.
- Local website production smoke required a temporary `STUDIO_BRAIN_INTEGRITY_OVERRIDE` because the smoke runner is coupled to an unrelated Studio Brain integrity manifest; the website behavior itself passed once the unrelated guard was bypassed.

## Notification Reliability Evidence
- [ ] Retry/backoff verified for retryable classes (`provider_5xx`, `network`, `unknown`)
- [ ] Dead-letter writes verified for exhausted/non-retryable failures
- [ ] Push telemetry emits sent/partial/failed outcomes
- [ ] Token invalidation verified on provider invalid-token responses
- [ ] Stale-token cleanup scheduler verified
- [ ] Drill script run log captured (`node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1`)
- [ ] Drill worksheet completed (`docs/DRILL_EXECUTION_LOG.md`)

## Observability Evidence
- [ ] `notificationMetrics/delivery_24h` snapshot updates every 30 minutes
- [ ] Threshold checks reviewed against `docs/NOTIFICATION_ONCALL_RUNBOOK.md`
- [ ] Current `statusCounts` / `reasonCounts` recorded below:

```txt
statusCounts:
reasonCounts:
providerCounts:
```

## Studio OS v3 Operational Evidence
- [x] Drill log scaffolding seeded for all quarterly scenarios in `docs/DRILL_EXECUTION_LOG.md`:
  - `token_compromise`
  - `connector_outage`
  - `policy_bypass_attempt`
  - `local_db_corruption`
- [x] Drill template helper script fixed and usable:
  - `scripts/new-studio-os-v3-drill-log-entry.ps1`
- [x] Ops endpoint contract integration coverage expanded in `studio-brain/src/http/server.test.ts`:
  - drill auth + required fields
  - drill metadata fidelity (`outcome`, `mttrMinutes`, `unresolvedRisks`)
  - degraded auth/status guardrails + metadata fidelity (`status`, `mode`)
  - staff-only read guards for `GET /api/ops/audit` and `GET /api/ops/drills`
- [x] Execute local-staging harness chaos drills and fill observed results in `docs/DRILL_EXECUTION_LOG.md`
- [x] Attach drill API evidence rows (`/api/ops/drills`, `/api/ops/audit`, `/api/capabilities/audit`) per scenario via `output/drills/studio-os-v3-local-2026-02-17T17-47-52-585Z.json`
- [x] Record MTTR + unresolved risks with owner/due date follow-ups in `docs/STUDIO_OS_V3_EVIDENCE_PACK.md`
- [ ] Re-run all four Studio OS v3 drills in staging with real staff credentials before beta sign-off
- [x] Operational evidence bundle doc created:
  - `docs/STUDIO_OS_V3_EVIDENCE_PACK.md`

## Security + Secrets Evidence
- [ ] `APNS_RELAY_KEY` configured in runtime environment for notification processors
- [ ] Relay key rotation drill completed
- [x] No plaintext secret values committed in repo docs/code (basic pattern scan; Firebase web `apiKey` is expected and not a secret)
- [ ] Rotation record:

```txt
rotationDate:
rotatedBy:
validationStart:
validationEnd:
rollbackNeeded: yes/no
```

## Risk Register (alpha -> beta gate)
- [x] Risk ID, owner, mitigation, and rollback path recorded for each open risk

```txt
RISK-001: Production notification drill requires real staff token + runtime config.
owner: Micah (owner/operator)
mitigation: Execute `node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1` using real staff token; capture evidence in `docs/DRILL_EXECUTION_LOG.md`.
rollback: Keep notification drill ticket open (`tickets/P0-alpha-drills-real-auth.md`) and do not promote alpha->beta without drill evidence.

RISK-002: portal.monsoonfire.com cutover depends on external DNS/hosting console actions.
owner: Micah (owner/operator)
mitigation: Follow `web/deploy/namecheap/README.md` and run `node ./web/deploy/namecheap/verify-cutover.mjs` after deployment.
rollback: Keep current known-good hosting path and do not switch traffic until cutover verification passes.

RISK-003: OAuth provider credentials (Apple/Facebook/Microsoft) are external-console managed.
owner: Micah (owner/operator)
mitigation: Execute `docs/PROD_AUTH_PROVIDER_EXECUTION.md` and verify provider sign-in on portal domain.
rollback: Disable any failing provider in Firebase Auth and retain Google/email sign-in availability.
```

## Sign-off
- Engineering lead:
- Mobile lead:
- Release manager:
- Date:

## Accessibility Changelog (Portal)
- Accessibility fixes included in this release:
- Known gaps accepted for release:
- Owner for follow-up:
- Due date:

## Accessibility Changelog (Website)
- Accessibility fixes included in this release:
- Known gaps accepted for release:
- Owner for follow-up:
- Due date:
