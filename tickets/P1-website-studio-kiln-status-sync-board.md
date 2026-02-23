# P1 — Website Studio Kiln Board API Sync

Status: Completed
Date: 2026-02-17

## Problem
The public site kiln board is static and manually updated, which causes drift from live reservation and firing state.

## Objective
Make website kiln status cards reflect near-live studio workflow state from the same backend source as portal data.

## Scope
- website pipeline:
  - `website/data/kiln-status.json`
  - `website/assets/js/kiln-status.js`
  - `website/index.html`
- function surface for public-safe status snapshots:
  - `functions/src` (new endpoint or existing apiV1 route)
- docs and rollout:
  - `docs/SCHEMA_RESERVATIONS.md`
  - `docs/PLAN_PROFILE.md` if reservation status messaging is surfaced there

## Tasks
1. Define a public kiln-status payload schema containing:
   - kiln name, next firing type, readiness band, queue summary, pickup readiness count.
2. Implement endpoint that serves studio board data with short TTL and no auth requirements, with strict field whitelist.
3. Update `website/assets/js/kiln-status.js` to support:
   - function fallback to `kiln-status.json` when endpoint is unavailable
   - last updated timestamp and error state copy.
4. Add a build/deploy note and one manual validation script/check to keep website data in sync.
5. Add docs:
   - expected refresh cadence
   - mapping between reservations->board state
   - incident/recovery steps when board is stale.

## Acceptance
- static/manual file can still render when API is unreachable.
- with function healthy, public board updates without manual JSON file edits.
- board data includes at least: status, controller/label, next planned firing, ready band, and last updated time.
- any backend contract change includes a short doc update in `docs/SCHEMA_RESERVATIONS.md`.

## Dependencies
- `tickets/P1-studio-queue-position-and-eta-band.md`
- `tickets/P1-studio-reservation-stage-timeline-and-audit.md`

## Completion Evidence (2026-02-23)
- Public-safe kiln board endpoint is implemented and exported:
  - `functions/src/websiteKilnBoard.ts`
  - `functions/src/index.ts` export: `websiteKilnBoard`
- Endpoint payload includes required board fields:
  - kiln/controller labels
  - next planned firing
  - readiness/pickup summary
  - queue summary + capacity + `lastUpdated`
- Website board loader uses API-first with static fallback on both site variants:
  - `website/assets/js/kiln-status.js`
  - `website/ncsitebuilder/assets/js/kiln-status.js`
  - fallback source: `/data/kiln-status.json`
- Deterministic validation check added:
  - script: `scripts/check-website-kiln-board.mjs`
  - npm command: `npm run website:kiln-board:check`
- Runbook added with cadence, mapping, and incident recovery:
  - `docs/runbooks/WEBSITE_KILN_BOARD_SYNC.md`
- Source-of-truth index updated to include kiln board runbook:
  - `docs/SOURCE_OF_TRUTH_INDEX.md`
