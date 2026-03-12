# Session Handoff - 2026-03-12 (Lending V1, Automation Guardrails, Staff Events)

## Scope
- Lending library metadata and manual-review tooling reached a shippable v1 state earlier in the session, including clean branch packaging work.
- Codex automation guardrails were added to stop unattended Spark drain and to make automation callers auditable.
- Staff Events planning workflow was extended and deployed live on `https://portal.monsoonfire.com`.

## Current branch and repo state
- Current working branch: `codex/lending-v1-shippable`
- Clean PR branch also exists locally: `codex/lending-v1-pr`
- The repo is heavily dirty beyond this session's scope. Do not assume the working tree is safe for a bulk commit.
- Today's staff Events and automation changes are present as working-tree edits on `codex/lending-v1-shippable`, not as fresh commits on the current branch tip.

## What was completed today

### 1. Lending library v1 cleanup and packaging
- Added member-facing incomplete-state treatments and staff-side metadata cleanup tooling for the lending catalog.
- Added research-assist links for manual metadata rescue while blocking retailer-hosted cover URLs from being saved.
- Expanded free-source metadata lookup support for books, comics, tabletop/RPG, and games in the lending architecture.
- User accepted the lending work as shippable for v1.
- A clean lending PR branch exists locally:
  - `codex/lending-v1-pr`
- Local branch history for that packaged lending branch includes:
  - `e3529b03 feat(lending): package lending v1 catalog and intake flows`
  - `313e5f9f docs(library): update lending v1 architecture notes`

### 2. Spark quota drain containment and automation guardrails
- Added repo-managed Codex automation controls:
  - `config/codex-automation-budget.json`
  - `scripts/codex-automation-audit.mjs`
  - `scripts/codex-automation-control.mjs`
  - `scripts/lib/codex-automation-control.mjs`
  - `docs/runbooks/CODEX_AUTOMATION_GUARDRAILS.md`
- Added tracked overnight user-systemd source of truth:
  - `config/monsoonfire/systemd/monsoonfire-overnight.service`
  - `config/monsoonfire/systemd/monsoonfire-overnight.timer`
  - `scripts/install-monsoonfire-automation-systemd.mjs`
- Updated runtime scripts so unattended Codex execution is gated and Spark is no longer the default automation model:
  - `scripts/intent-codex-proc.mjs`
  - `scripts/overnight-automation-loop.sh`
  - `scripts/codex-shell.mjs`
- Audit findings from today's work:
  - Main Spark drain path was `monsoonfire-overnight.service` -> `scripts/overnight-automation-loop.sh` -> `scripts/intent-codex-proc.mjs`
  - Historical automated Spark usage observed in proc reports: `1695`
  - Historical quota-failure reports observed: `1282`
  - `monsoonfire-daily` was broken noise, not the main Spark quota sink
- Local machine state changes completed today:
  - `monsoonfire-overnight.timer` disabled
  - `monsoonfire-overnight.service` inactive
  - repo-managed overnight user units installed under `~/.config/systemd/user`
  - `monsoonfire-daily.timer` and `monsoonfire-daily.service` removed from `~/.config/systemd/user`
  - cleanup backup written to:
    - `~/.config/systemd/user/backups/monsoonfire-daily-cleanup-2026-03-12T02-15-02Z`
- Live local status at handoff time:
  - `systemctl --user is-enabled monsoonfire-overnight.timer` -> `disabled`
  - `systemctl --user is-active monsoonfire-overnight.service` -> `inactive`
  - `systemctl --user status monsoonfire-daily.timer` -> `Unit monsoonfire-daily.timer could not be found.`

### 3. Staff Events planning workflow slices
- Added `Load into planning` to the workshop programming table so staff can promote a programming cluster into the Events planning surface.
- Added an active planning cue and prefilled quick-create draft details from the selected cluster.
- Added direct-route Events auto-load so `/staff/cockpit/events` no longer requires a manual refresh to populate the programming table.
- Fixed the duplicate-title case so planning focuses on the exact reference event id when a cluster contains multiple similarly titled events.

## Key files touched today

### Lending and metadata rescue
- `functions/src/apiV1.ts`
- `functions/src/apiV1.test.ts`
- `functions/src/library.ts`
- `functions/src/library.test.ts`
- `web/src/views/LendingLibraryView.tsx`
- `web/src/views/LendingLibraryView.css`
- `web/src/views/LendingLibraryView.test.ts`
- `web/src/views/LendingLibraryView.ui.test.tsx`
- `web/src/views/StaffView.tsx`
- `web/src/views/staff/LendingModule.tsx`
- `web/src/views/staff/LendingModule.test.tsx`
- `web/src/views/staff/LendingIntakeModule.tsx`
- `web/src/views/staff/LendingIntakeModule.test.tsx`
- `web/src/views/staff/LendingCatalogEditor.tsx`
- `web/src/views/staff/LendingCatalogEditor.test.tsx`
- `web/src/views/staff/lendingResearch.ts`
- `web/src/views/staff/lendingResearch.test.ts`
- `docs/library/ARCHITECTURE.md`

### Automation guardrails
- `config/codex-automation-budget.json`
- `config/monsoonfire/systemd/monsoonfire-overnight.service`
- `config/monsoonfire/systemd/monsoonfire-overnight.timer`
- `docs/runbooks/CODEX_AUTOMATION_GUARDRAILS.md`
- `scripts/codex-automation-audit.mjs`
- `scripts/codex-automation-control.mjs`
- `scripts/lib/codex-automation-control.mjs`
- `scripts/install-monsoonfire-automation-systemd.mjs`
- `scripts/intent-codex-proc.mjs`
- `scripts/overnight-automation-loop.sh`
- `scripts/codex-shell.mjs`

### Staff Events
- `web/src/views/StaffView.tsx`
- `web/src/views/staff/EventsModule.tsx`
- `web/src/views/StaffView.ui.test.tsx`
- `web/src/views/staff/EventsModule.test.tsx`

## Verification run today

### Lending
- `npm --prefix functions test -- --runInBand`
- `npm --prefix web run test:run -- src/views/staff/lendingResearch.test.ts src/views/staff/LendingCatalogEditor.test.tsx src/views/staff/LendingModule.test.tsx src/views/staff/LendingIntakeModule.test.tsx src/views/LendingLibraryView.test.ts src/views/LendingLibraryView.ui.test.tsx src/views/StaffView.ui.test.tsx`
- `npm --prefix functions run build`
- `npm --prefix web run build`
- `npm run deploy:namecheap:portal`

### Automation
- `node --check scripts/codex-automation-audit.mjs`
- `node --check scripts/codex-automation-control.mjs`
- `node --check scripts/intent-codex-proc.mjs`
- `node --check scripts/codex-shell.mjs`
- `bash -n scripts/overnight-automation-loop.sh`
- `npm run --silent codex:automation:audit`
- `npm run --silent codex:automation:status`
- `npm run --silent codex:automation:install-systemd`
- `npm run --silent codex:automation:pause`
- Smoke dry run:
  - `node ./scripts/intent-codex-proc.mjs ... --launcher monsoonfire-overnight.service --model gpt-5.3-codex-spark --dry-run`

### Staff Events
- `npm --prefix web run test:run -- src/views/staff/EventsModule.test.tsx src/views/StaffView.ui.test.tsx`
- `npm --prefix web run build`
- `npm run deploy:namecheap:portal`

## Live verification and artifacts

### Lending
- Member shelf and staff lending surfaces were visually checked on `https://portal.monsoonfire.com`
- Saved artifacts:
  - `output/qa/lending-live-check/lending-library-shelf-live.png`
  - `output/qa/lending-live-check/staff-lending-metadata-gap-queue-live.png`
  - `output/qa/lending-live-check/staff-lending-cover-review-queue-live.png`
  - `output/qa/lending-live-check/staff-lending-research-links-live.png`
  - `output/qa/lending-live-check/staff-lending-retail-warning-live.png`
  - `output/qa/lending-live-check/lending-library-shelf-live-after-refresh.png`
  - `output/qa/lending-live-check/staff-lending-live-after-refresh.png`

### Staff Events
- Workshop programming row and `Load into planning` verified live:
  - `output/qa/staff-events-programming-live/staff-events-before-refresh.png`
  - `output/qa/staff-events-programming-live/staff-events-after-refresh.png`
- Direct route auto-load verified live:
  - `output/qa/staff-events-autoload-live/staff-events-autoload.png`
- Duplicate-title planning focus verified live:
  - `output/qa/staff-events-focus-live/staff-events-focus-after-click.png`

## Outstanding issues and caveats
- `artifacts/deploy-evidence-latest.json` and `artifacts/deploy-evidence-latest.md` still report a false failed state because they include stale March 10 rollback artifacts. Today's deploys themselves passed cutover verification and promotion gating.
- The repo still has a very large unrelated dirty tree. Any PR or commit packaging for today's non-lending work needs selective staging from a clean branch or worktree.
- There is still a separate manual OpenAI caller in `scripts/pst-memory-analyze-hybrid.mjs`. It was not part of today's overnight Spark drain path, but it remains worth reviewing if quota pressure returns.
- The current branch tip does not contain today's events/automation changes as committed history yet.

## Recommended next steps
1. Package today's automation guardrails into a clean PR-sized branch that excludes deploy evidence artifacts and unrelated repo churn.
2. Package today's Staff Events planning slices into a clean PR-sized branch or fold them into the active portal branch strategy.
3. Fix deploy-evidence generation so stale rollback artifacts no longer contaminate current release status.
4. Continue the Staff Events planning flow by prefilling date/time and duration from the cluster reference event if that workflow stays hot.

## Fast re-entry checklist
1. Confirm local timer state:
   - `systemctl --user is-enabled monsoonfire-overnight.timer`
   - `systemctl --user status monsoonfire-daily.timer --no-pager --lines=0 || true`
2. Re-run the automation audit:
   - `npm run --silent codex:automation:audit`
3. Rebuild and smoke the portal work:
   - `npm --prefix web run test:run -- src/views/staff/EventsModule.test.tsx src/views/StaffView.ui.test.tsx`
   - `npm --prefix web run build`
4. If pushing a fresh live portal deploy:
   - `npm run deploy:namecheap:portal`
