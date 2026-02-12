Status: Open

# P0 - Run notification drill suite in production with real staff auth

- Repo: portal
- Area: Notifications / Release
- Evidence: `docs/DRILL_EXECUTION_LOG.md` is template-only; prior drill attempts returned `UNAUTHENTICATED` due to placeholder/invalid tokens.
- Recommendation:
  - Obtain a real Firebase ID token for a staff user (see `docs/NOTIFICATION_ONCALL_RUNBOOK.md`).
  - Run `scripts/run-notification-drills.ps1` against deployed functions.
  - Capture outputs and verify Firestore collections: `notificationJobDeadLetters`, `notificationDeliveryAttempts`, `notificationMetrics/delivery_24h`.
- Update (2026-02-06): drill runner now validates `-IdToken` (JWT issuer check), strips accidental `Bearer ` prefix, and refuses placeholder tokens. Still blocked on obtaining a real staff ID token.
- Update (2026-02-12): remains pending owner environment/config completion (real production staff token acquisition and execution window). Tagged as non-blocking config follow-up for ongoing alpha hardening.
- Update (2026-02-12): added `scripts/new-drill-log-entry.ps1` to auto-append a sanitized drill log template to `docs/DRILL_EXECUTION_LOG.md` for faster execution evidence capture.
- Update (2026-02-12): `scripts/run-notification-drills.ps1` now supports `-OutputJson` and `-LogFile` so each run can generate structured evidence for audit/review without manual copy/paste.
- Update (2026-02-12): `scripts/run-external-cutover-checklist.ps1` now includes the drill run command and evidence handoff sequence in the generated execution plan.
- Effort: S
- Risk: Low
- What to test: all drill modes execute without `UNAUTHENTICATED` and produce expected retry/dead-letter behavior.

Notes:
- `-Uid` must be the Firebase Auth UID (not a display name like `studiomgr`). Use `window.__mfGetUid?.()` (local dev helper) or inspect the token's `user_id` claim.
