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

## Notification Reliability Evidence
- [ ] Retry/backoff verified for retryable classes (`provider_5xx`, `network`, `unknown`)
- [ ] Dead-letter writes verified for exhausted/non-retryable failures
- [ ] Push telemetry emits sent/partial/failed outcomes
- [ ] Token invalidation verified on provider invalid-token responses
- [ ] Stale-token cleanup scheduler verified
- [ ] Drill script run log captured (`scripts/run-notification-drills.ps1`)
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
- [ ] Risk ID, owner, mitigation, and rollback path recorded for each open risk

```txt
RISK-001:
owner:
mitigation:
rollback:
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
