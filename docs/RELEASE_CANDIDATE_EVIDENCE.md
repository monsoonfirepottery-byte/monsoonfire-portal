# Release Candidate Evidence Pack

## Build + CI Evidence
- [x] `Smoke Tests` workflow pass ([run 21955700046](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/21955700046))
- [x] `Lighthouse Audit` workflow pass ([run 21955700011](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/21955700011))
- [x] `iOS macOS Smoke` workflow pass ([run 21955699963](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/21955699963))
- [x] `ios-build-gate` workflow pass ([run 21955700012](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/21955700012))
- [x] `Android Compile Check` workflow pass ([run 21955700047](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/21955700047))
- [x] `Deploy to Firebase Hosting on PR` workflow pass ([run 21955700044](https://github.com/monsoonfirepottery-byte/monsoonfire-portal/actions/runs/21955700044))
- [x] Functions TypeScript build pass (`npm --prefix functions run build`)
- [x] Functions lint pass (`npm --prefix functions run lint`) (warnings only)
- [x] Web lint pass (`npm --prefix web run lint`)
- [x] Web tests pass (`npm --prefix web run test:run`)
- [x] Web build pass (`npm --prefix web run build`)
- [x] Web chunk budgets pass (`npm --prefix web run perf:chunks`)
- [x] Alpha preflight script run (`node ./scripts/ps1-run.mjs scripts/alpha-preflight.ps1`) on head `62eba15dc593cb1c1422183e4d314238859dca51`

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
