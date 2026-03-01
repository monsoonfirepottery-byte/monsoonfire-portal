# Portal Performance QA Lanes

Purpose: close the gap between smoke/canary correctness checks and performance regression detection.

## What this adds

1. Load/stress lane for public portal endpoint behavior under varying concurrency.
2. Functions coldstart lane for backend import-latency regression detection.

## Coverage map (research snapshot)

Existing lanes already in repo:
- smoke/canary (functional correctness)
- authz/rules/index drift
- accessibility + theme contrast
- security scans and docs drift checks

Gaps closed in this pass:
- sustained request pressure behavior (load + rate-limit thresholds)
- backend startup latency regression (coldstart budget gate)

## Preflight checklist (fast-to-slower)

```bash
# 1) Fast backend coldstart gate (local build artifacts required)
npm run functions:profile:coldstart:strict

# 2) Fast load profile
npm run portal:load:test:quick

# 3) Full baseline load profile
npm run portal:load:test

# 4) Endurance/soak profile
npm run portal:load:test:soak

# 5) Combined pass (recommended before merge on performance-sensitive changes)
npm run qa:preflight:performance
```

`qa:preflight:performance` behavior:
- Runs coldstart strict gate.
- Runs quick load profile.
- If quick load fails with a pure saturation signature (rate-limit dominated, no server/network errors), it retries once after cooldown.
- Writes summary artifact: `output/qa/performance-preflight.json`.

Secrets note:
- Load `secrets/portal/portal-automation.env` before running deploy/promotion-related checks; this file now includes `PORTAL_FIREBASE_API_KEY` as a populated local baseline entry.

## Reproduce reliably

### Load lane

Default target:
- `https://us-central1-monsoonfire-portal.cloudfunctions.net/websiteKilnBoard`

Manual command:

```bash
node ./scripts/portal-load-test.mjs \
  --profile default \
  --strict \
  --write \
  --json \
  --report-json output/qa/portal-load-test.json \
  --report-markdown output/qa/portal-load-test.md
```

Use `--profile soak` for the endurance lane.

Expected output:
- JSON report with `"status": "pass"`
- Per-scenario `thresholdBreaches` should be empty
- Artifacts at:
  - `output/qa/portal-load-test.json`
  - `output/qa/portal-load-test.md`
- If you run load profiles repeatedly, allow ~60 seconds between runs to avoid carrying over shared rate-limit saturation from the previous run.
- `soak` profile adds a rate-limited ratio cap so "up but heavily throttled" behavior is treated as a failure signal.

### Coldstart lane

Manual command:

```bash
node ./scripts/functions-coldstart-profile.mjs \
  --runs 7 \
  --strict \
  --max-p95-ms 1500 \
  --artifact output/functions-coldstart-profile/latest.json \
  --report-markdown output/functions-coldstart-profile/latest.md \
  --json
```

Expected output:
- Report with `"status": "pass"`
- `breaches` array empty
- Artifacts at:
  - `output/functions-coldstart-profile/latest.json`
  - `output/functions-coldstart-profile/latest.md`

## CI workflows

- `.github/workflows/portal-load-test.yml`
  - schedule: daily
  - manual overrides: profile (`quick|default|deep|soak`)/base URL/path/timeout/strict
- `.github/workflows/functions-coldstart-regression.yml`
  - schedule: daily
  - manual overrides: runs/max p95/budget overrides/strict

Both workflows upload artifacts for dashboard and weekly-digest ingestion.
Repeated load/coldstart failures are auto-eligible for ticket generation through the existing `portal-automation-health-daily` -> `portal-automation-issue-loop` path.

## Budget tuning guidance

- Keep strict mode enabled by default.
- Change thresholds only after reviewing at least 5 recent artifacts and confirming sustained infra shift (not one-off noise).
- Prefer per-target coldstart budgets with `--budget <target>=<ms>` over raising global budgets.

## Rollback plan

If these lanes cause unexpected blocking:

1. Dispatch workflow manually with `strict=false` to gather artifacts without blocking.
2. Revert only workflow strictness (not script support) so observability remains.
3. Restore previous behavior by reverting:
   - `.github/workflows/portal-load-test.yml`
   - `.github/workflows/functions-coldstart-regression.yml`
   - `scripts/functions-coldstart-profile.mjs` strict/budget additions
4. Keep artifacts from failing runs for postmortem before any threshold relax.
