# Session Handoff - 2026-02-06

## Snapshot
- Branch/worktree is intentionally dirty with broad in-flight changes across web/functions/docs/ios.
- Core push migration and release-control work is implemented and mostly deployed.
- Sprint board tracks S1-S9 as `ready_for_verification`; Sprint 10 is staged as `todo` launch-closure work.

## Deployed state
- Firestore indexes deployed (`firestore.indexes.json`), including:
  - `collectionGroup=deviceTokens`, fields: `active ASC`, `updatedAt ASC`.
- Cloud Functions:
  - Legacy `assignFiring` is archived (removed from active exports; see `functions/archive/index_old.ts`).
  - Runtime configured via `functions/package.json` engines: `node 22` (CI workflows use Node 22).
  - New/active endpoints (see `functions/src/index.ts`) include:
    - `registerDeviceToken`
    - `unregisterDeviceToken`
    - `runNotificationFailureDrill`
    - `runNotificationMetricsAggregationNow`
  - Notification processors and schedulers updated and deployed:
    - retry/dead-letter pipeline
    - delivery metrics aggregation
    - stale token cleanup

## Implemented behavior (high signal)
- Push token lifecycle:
  - register/unregister endpoints
  - stale-token deactivation scheduler
- Push delivery:
  - relay-backed send adapter (env-based key)
  - invalid-token auto-deactivation on provider codes
- Reliability:
  - failure classification and retry/backoff
  - dead-letter writes (`notificationJobDeadLetters`)
- Observability:
  - per-attempt telemetry (`notificationDeliveryAttempts`)
  - 24h aggregate snapshot (`notificationMetrics/delivery_24h`)
  - manual aggregate trigger endpoint
- Drill tooling:
  - deterministic drill injection endpoint
  - PowerShell runner: `scripts/run-notification-drills.ps1`
- Dev ergonomics:
  - persistent emulator env loader: `scripts/start-emulators.ps1`
  - template: `functions/.env.local.example`

## Known blockers / gotchas
- Drill run failed because placeholder token was used (`<ID_TOKEN>`). Need real staff Firebase ID token.
- `functions/.env` had `ADMIN_TOKEN` conflict with existing secret-based config on some functions; removed to allow deploy.
- Root and functions dependencies upgraded, but vulnerabilities remain (`npm audit` not remediated in this session).
- No macOS runtime validation performed in-session; CI workflow exists, but manual iOS/Xcode runtime testing still pending.
- `S8-04` is now documented as runtime env hardening (not managed-secret migration).
- Firebase Hosting output now points at `web/dist` (not the default `public/` placeholder); hosting `predeploy` runs `npm --prefix web run build`.
- Website JSON-LD is externalized (`website/assets/schema/localbusiness.json`) and CSP no longer relies on a `script-src` hash.
- Website `/assets` cache TTL is short (1 hour) to avoid stale CSS/JS; `/assets/images` remains long-lived (365 days).
- Functions lint now passes and is wired into the smoke workflow; run `npm --prefix functions run lint`.

## Local verification (this environment)
- Node: `v20.19.0` (note: `functions/package.json` engines is 22; CI workflows use Node 22)
- `npm --prefix functions run build` OK
- `npm --prefix functions run lint` OK (0 errors, warnings only)
- `npm --prefix web run lint` OK
- `npm --prefix web run test:run` OK (9 files, 27 tests)
- `npm --prefix web run build` OK
- `npm --prefix web run perf:chunks` OK
- Basic secret scan: no private keys or token strings found in tracked files; `web/src/firebase.ts` contains a Firebase web `apiKey` (expected, not a secret).

## Resume commands
### 1) Start emulators with stable env
```powershell
pwsh -File scripts/start-emulators.ps1
```

### 2) Run notification drill suite (requires real ID token)
```powershell
pwsh -File scripts/run-notification-drills.ps1 `
  -BaseUrl "https://us-central1-monsoonfire-portal.cloudfunctions.net" `
  -IdToken "<REAL_ID_TOKEN>" `
  -Uid "<REAL_UID>" `
  -AdminToken "<REAL_ADMIN_TOKEN_IF_NEEDED>"
```

### 3) Build/lint quick verification
```powershell
npm --prefix functions run build
npm --prefix functions run lint
npm --prefix web run lint
```

## Documents to finalize next
1. `docs/DRILL_EXECUTION_LOG.md`
2. `docs/RELEASE_CANDIDATE_EVIDENCE.md`
3. `docs/NOTIFICATION_ONCALL_RUNBOOK.md` (fill real thresholds from drill data)

## Recommended first action next session
- Re-run drills with real token, then immediately copy counts/outcomes into evidence docs and close alpha gate.
