# Journey Testing Runbook

Status: Active (Epic 12)
Date: 2026-02-22
Owner: QA + Portal + Functions

## Purpose

Operational guide for running and maintaining journey + Stripe negative-outcome regression coverage.

## Test lanes

1. Fast lane (PR-safe deterministic subset)
   - `npm run test:journey:fast`
2. Deep lane (expanded coverage)
   - `npm run test:journey:deep`
3. Stripe negative contracts only
   - `npm run test:stripe:negative`
4. Contract-only checks
   - `npm run test:journey:contracts`

## What each lane validates

### Fast lane

1. Functions build compiles cleanly.
2. Stripe webhook contracts and negative-event mapping tests.
3. Targeted reservation/dropoff/pickup journey tests in `functions/src/apiV1.test.ts`.
4. `continueJourney` contract consistency across functions/docs/web contracts.
5. Fixture schema + secret-marker checks.

### Deep lane

1. Everything in fast lane.
2. Full functions test suite.
3. Web journey-related unit tests (`functionsClient` + reservations normalizer tests).
4. Reservations Playwright guardrail check:
   - optional when `MF_RUN_RESERVATIONS_PLAYWRIGHT=1`
   - required when `MF_REQUIRE_RESERVATIONS_PLAYWRIGHT=1`
   - credentials required: `PORTAL_CLIENT_PASSWORD` or `PORTAL_STAFF_PASSWORD`
5. Optional strict agent-commerce smoke (runs when `MF_AGENT_TOKEN`/`MF_PAT`/`PAT` is set).

## Deep-lane flags

1. Enable reservations Playwright journey check:
   - `MF_RUN_RESERVATIONS_PLAYWRIGHT=1`
   - `PORTAL_URL=<target>`
   - `PORTAL_CLIENT_PASSWORD=<password>` (or `PORTAL_STAFF_PASSWORD`)
2. Promote reservations Playwright to required deep-lane coverage:
   - `MF_REQUIRE_RESERVATIONS_PLAYWRIGHT=1`
   - `PORTAL_URL=<target>`
   - `PORTAL_CLIENT_PASSWORD=<password>` (or `PORTAL_STAFF_PASSWORD`)
3. Enable strict agent commerce smoke:
   - `MF_AGENT_TOKEN=<token>` (or `MF_PAT` / `PAT`)

## Fixtures and seed governance

Primary fixture:
- `functions/scripts/fixtures/agent-commerce-smoke.base.json`

Rules:
1. Keep fixtures static, deterministic, and public-safe.
2. Do not include real bearer tokens, live Stripe keys, or internal URLs.
3. Any fixture shape change must pass:
   - `node ./scripts/check-journey-fixtures.mjs --strict --json`
4. Add new fixture keys as additive where possible; avoid breaking existing keys.

## Agent commerce strict smoke usage

1. Exploratory mode:
   - `npm --prefix functions run agent:commerce:smoke -- --token "<token>"`
2. Regression mode (strict):
   - `npm --prefix functions run agent:commerce:smoke:strict -- --token "<token>" --baseUrl "http://127.0.0.1:5001/monsoonfire-portal/us-central1"`

Optional staff automation:
- add `--staffToken "<firebase_staff_id_token>"` to auto-approve manual-review reservations and run fulfillment transitions.

## Release evidence checklist

For release candidates, capture:
1. Commit SHA + lane command used.
2. Artifact files:
   - `output/journey-tests/fast.json`
   - `output/journey-tests/deep.json` (if deep lane executed)
   - `output/journey-tests/continue-journey-contract.json`
   - `output/journey-tests/fixtures-check.json`
3. Pass/fail summary and first failing scenario (if any).
4. If deep lane optional steps were skipped (e.g., no token for agent smoke), explicitly note skip reason.

## Failure triage

1. Stripe mapping failures:
   - inspect `functions/src/stripeConfig.ts` and `functions/src/stripeConfig.test.ts`.
2. Reservation journey failures:
   - inspect `functions/src/apiV1.ts` and `functions/src/apiV1.test.ts`.
3. Contract check failures:
   - inspect:
     - `functions/src/index.ts`
     - `web/src/api/portalContracts.ts`
     - `docs/API_CONTRACTS.md`
     - `docs/CONTINUE_JOURNEY_AGENT_QUICKSTART.md`
4. Fixture failures:
   - inspect `functions/scripts/fixtures/agent-commerce-smoke.base.json`.
