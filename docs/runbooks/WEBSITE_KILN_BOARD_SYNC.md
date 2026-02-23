# Website Kiln Board Sync Runbook

## Purpose
Keep the public kiln board (`/kiln-firing/`) aligned with live portal operations while preserving static fallback behavior.

## Data flow
1. Public endpoint: `GET /api/websiteKilnBoard` (`functions/src/websiteKilnBoard.ts`)
2. Website loader tries API first, then falls back to static JSON:
   - `website/assets/js/kiln-status.js`
   - `website/ncsitebuilder/assets/js/kiln-status.js`
3. Static fallback files:
   - `website/data/kiln-status.json`
   - `website/ncsitebuilder/data/kiln-status.json`

## Payload contract (public-safe)
- `lastUpdated` (ISO string)
- `updatedBy` (string)
- `kilns[]` where each row contains:
  - `name`
  - `controller`
  - `nextFireType`
  - `nextFirePlanned`
  - `readyForPickup`
  - `notes`
  - `capacity`

## Mapping from reservations to board
- Source reservations are active statuses only (`REQUESTED`, `CONFIRMED`, `WAITLISTED`).
- Grouping key: station (`assignedStationId` fallback `kilnId`).
- Queue summary:
  - queued/loaded/loading half-shelf counts from reservation footprint estimation.
- Next firing:
  - pulled from `kilnFirings` by station and nearest upcoming/active start.

## Refresh cadence
- Expected cadence: near-live on page load (API read at runtime).
- Static JSON fallback is a resilience layer; it should remain valid and renderable even if the API is unavailable.

## Validation
- Run deterministic contract check before deploy:
  - `npm run website:kiln-board:check`
- This checks:
  - function payload surface keys
  - website loader fallback paths
  - static fallback JSON shape

## Incident recovery (stale board)
1. Confirm endpoint health:
   - `GET https://us-central1-monsoonfire-portal.cloudfunctions.net/websiteKilnBoard`
2. Run validation script:
   - `npm run website:kiln-board:check`
3. If endpoint is degraded:
   - keep static JSON fallback published
   - update fallback `lastUpdated` and notes copy if needed
4. After recovery:
   - verify board loads from API in browser network (`/api/websiteKilnBoard`)
   - keep fallback JSON intact for future outages
