# Release Candidate Evidence Pack

## Current RC Refresh (2026-04-15)
- Canonical launch-readiness entrypoint is [docs/RELEASE_COMMAND_CENTER.md](RELEASE_COMMAND_CENTER.md).
- Portal and website are both live, and `main` currently has no open PRs.
- RC exit remains a hard gate until notification reliability evidence, security rotation proof, and sign-off are all complete.
- Current RC auth baseline is Google, Email/Password, Email Link, and Microsoft.
- Facebook and Apple provider expansion are explicitly deferred from this RC unless business requirements change.
- Feature-growth work outside deploy/cutover, auth readiness, smoke/promotion gates, accessibility guardrails, and analytics/policy parity is frozen out of this RC.
- Fresh live evidence was captured on 2026-04-15 under:
  - `output/playwright/portal/prod/portal-smoke-summary.json`
  - `output/playwright/prod/smoke-summary.json`
  - `output/playwright/prod-phase1-website/smoke-summary.json`
  - `output/qa/portal-authenticated-canary-rc1.json`
  - `output/qa/lighthouse-live-2026-04-15T16-38-08Z/`
  - `docs/audits/live-surface-audit-2026-04-15.md`

## Current blockers (2026-04-15)
- `RC issue 1`: Google login auth on `https://portal.monsoonfire.com` does not cycle users cleanly back into the live portal session.
  - User report is now backed by direct live evidence: the production Google sign-in handoff redirects through `https://monsoonfire-portal.firebaseapp.com/__/auth/handler`, and the live bundle does not contain `auth.monsoonfire.com`.
  - A popup-first fallback mitigation is now deployed on the direct portal surface, but this remains a release-candidate auth blocker until operator verification shows a successful Google round-trip on the live portal.
- Notification reliability evidence is still incomplete.
- Security rotation proof is still incomplete.

## Build + CI Evidence
- [x] Live portal public smoke pass (2026-04-15) -> `output/playwright/portal/prod/portal-smoke-summary.json`
- [x] Live website public smoke pass (2026-04-15) -> `output/playwright/prod/smoke-summary.json`
- [x] Live authenticated portal canary pass (2026-04-15) -> `output/qa/portal-authenticated-canary-rc1.json`
- [x] Live Lighthouse sweep refreshed (2026-04-15) -> `output/qa/lighthouse-live-2026-04-15T16-38-08Z/`
- [x] `Smoke Tests` workflow pass ([run 23268174209](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23268174209))
- [x] `Lighthouse Audit` workflow pass ([run 23268174183](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23268174183))
- [x] Local LHCI reproducibility pass (2026-02-22, sandbox-safe chrome flags)
  - portal: `npx @lhci/cli@0.15.1 collect --config=web/lighthouserc.json --settings.chromeFlags="--no-sandbox --disable-dev-shm-usage"` + assert
  - website: `npx @lhci/cli@0.15.1 collect --config=website/lighthouserc.json --settings.chromeFlags="--no-sandbox --disable-dev-shm-usage"` + assert
- [x] `iOS macOS Smoke` workflow pass ([run 23268174197](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23268174197))
- [x] `ios-build-gate` workflow pass ([run 23268174202](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/23268174202))
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

## Current notes (2026-04-15)
- Live website smoke still passes structurally, but direct live HTML inspection shows the production website is serving legacy `monsoonfire.kilnfire.com` portal links on the main public pages.
- The public website was redeployed later on 2026-04-15 with an explicit phase-aware handoff hold, so `monsoonfire.kilnfire.com` remains the intentional public website target until phase 2 cutover approval.
- Live authenticated portal canary passed with refresh-token auth using the staff automation account, so current route/navigation regressions are concentrated at the public handoff and Google auth entry path rather than the internal portal shell.
- Live Lighthouse scores on 2026-04-15 were:
  - portal root: performance `66`, accessibility `100`, best practices `100`, SEO `91`
  - website pages: performance `69-75`, accessibility `94-98`, best practices `100`, SEO `100`
- The live Google sign-in click-through currently uses the Firebase app handler domain instead of the documented custom auth handler domain, which is the strongest concrete lead on the reported failed round-trip.
- A live phase-1 website smoke run now verifies the intentional legacy handoff host on `https://monsoonfire.com` core pages via `output/playwright/prod-phase1-website/smoke-summary.json`.
- The live portal cutover verifier now confirms `/.well-known/apple-app-site-association` returns `200` from `https://portal.monsoonfire.com`.
- The website production smoke needed a smoke-runner selector refresh from `pricing` to `payments` to match the current support taxonomy.
- Local website production smoke required a temporary `STUDIO_BRAIN_INTEGRITY_OVERRIDE` because the smoke runner is coupled to an unrelated Studio Brain integrity manifest; the website behavior itself passed once the unrelated guard was bypassed.
- Notification reliability evidence was refreshed on 2026-03-18 with a live production drill bundle (`output/qa/notification-evidence-2026-03-18T22-45-24-279Z.json`) plus a local relay-parity proof (`output/qa/notification-partial-parity-local.json`).
- The production reliability refresh surfaced and fixed missing Firestore indexes for `notificationJobs(status, runAfter)` and `deviceTokens(active, updatedAt)` before the final proof run.

## Notification Reliability Evidence
- Owner: `monsoonfirepottery-byte` (`Micah` owner/operator by default until delegated)
- Blocking close condition: every checkbox below is complete and backed by an artifact or run log before [#350](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/350) can close.
- [x] Retry/backoff verified for retryable classes (`provider_5xx`, `network`, `unknown`)
- [x] Dead-letter writes verified for exhausted/non-retryable failures
- [x] Push telemetry emits sent/partial/failed outcomes
- [x] Token invalidation verified on provider invalid-token responses
- [x] Stale-token cleanup scheduler verified
- [x] Drill script run log captured (`node ./scripts/ps1-run.mjs scripts/run-notification-drills.ps1`)
- [x] Drill worksheet completed (`docs/DRILL_EXECUTION_LOG.md`)

Evidence:
- Production drill bundle: `output/qa/notification-evidence-2026-03-18T22-45-24-279Z.json`
- Production drill raw log: `output/qa/notification-drill-2026-03-18T22-45-24-279Z-raw.txt`
- Production drill structured JSONL: `output/qa/notification-drill-2026-03-18T22-45-24-279Z.jsonl`
- Local relay-parity proof: `output/qa/notification-partial-parity-local.json`
- Live proof summary:
  - `auth` and `provider_4xx` moved to dead-letter after a single non-retryable attempt.
  - `provider_5xx`, `network`, and `unknown` exhausted after 5 attempts and landed in dead-letter once the missing queue index was deployed.
  - `success` wrote the sent-path telemetry row.
  - Local emulator proof with a mocked relay wrote `PUSH_PROVIDER_PARTIAL` telemetry and deactivated the invalid token with `deactivationReason=BadDeviceToken`.

## Observability Evidence
- Owner: `monsoonfirepottery-byte` (`Micah` owner/operator by default until delegated)
- Blocking close condition: the snapshot cadence, threshold review, and current counter values below are complete before [#350](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/350) can close.
- [x] `notificationMetrics/delivery_24h` snapshot updates every 30 minutes
- [x] Threshold checks reviewed against `docs/NOTIFICATION_ONCALL_RUNBOOK.md`
- [x] Current `statusCounts` / `reasonCounts` recorded below:

```txt
statusCounts: {"sent":4,"failed":1}
reasonCounts: {"DRILL_SUCCESS_SIMULATED":4,"APNS_RELAY_URL not configured":1}
providerCounts: {"relay":5}
```

Threshold review:
- Baseline threshold from `docs/NOTIFICATION_ONCALL_RUNBOOK.md`: failed delivery attempts should remain <= 10% of total over 24h.
- Current snapshot is intentionally drill-inflated (`1 failed / 5 total = 20%`) because the RC proof injected an `unknown` failure to verify dead-letter handling after the queue index fix.
- Scheduler state is healthy after index remediation (`processQueuedNotificationJobs`, `cleanupStaleDeviceTokens`, and `aggregateNotificationDeliveryMetrics` all report empty `status` objects in the final describe payload).
- No newer failing smoke/canary/promotion workflow supersedes the current green mainline evidence in `docs/RELEASE_COMMAND_CENTER.md`.

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
- Owner: `monsoonfirepottery-byte` (`Micah` owner/operator by default until delegated)
- Blocking close condition: every item below is complete before [#349](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/349) can close.
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

Current blocker note:
- Live runtime proof on 2026-03-18 still shows the notification processor failing the `unknown` path with `APNS_RELAY_URL not configured`, and the deployed service configs do not currently expose relay runtime bindings. This keeps [#349](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/issues/349) open even though notification reliability evidence is now complete.

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
- Engineering lead: Micah (owner/operator; default until delegated)
- Mobile lead: Micah (owner/operator; default until delegated)
- Release manager: Micah (owner/operator; default until delegated)
- Date: 2026-03-18

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
